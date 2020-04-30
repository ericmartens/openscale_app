//import dependencies
const axios = require('axios');
const express = require('express');
const hbs = require('hbs');
const auth = require('./auth.js');
const app = express();

//app settings. use handlebars for our view engine, and set up express
app.set('view engine', 'hbs');
app.use(express.static('dist'));
app.use(express.json());
app.use(express.urlencoded({extended: true}));

//routes here
app.get('/', (req, res) => res.render('index.hbs'));

app.get('/application', (req, res) => {
    res.render('application.hbs');
});

app.post('/application_results', (req, res) => {
    //take the POST data submitted via the application form and send it to our machine
    //learning model for a prediction, then display the prediction details. in a production
    //app we'd render the page with a progress bar until the model had returned a prediction
    get_prediction(req.body).then((value) => {
        console.log(value.values[0]);
        let outcome_result = "LOW RISK";
        let outcome_text = "Congratulations! Your application is likely to be approved!";
        if (value.values[0][0] === "YES") {
            outcome_result = "HIGH RISK";
            outcome_text = "Unfortunately, your application is not likely to be approved.";
        }
        let confidence = value.values[0][1][0];
        if (value.values[0][1][1] > confidence) {
            confidence = value.values[0][1][1];
        }
        confidence *= 100;
        res.render('application_results.hbs', {outcome_result, outcome_text, confidence});
    });
});

app.get('/explain', (req, res) => {
    //get the last prediction made by the model, and explain it. in a production app, we would need
    //to make sure we're explaining the relevant prediction and not just the last one. also, in a
    //production app we'd render the page with a loading bar while we waited for the explanation
    //service to finish.
    get_explanation().then((value) => {
        console.log(value);

        //make the confidence and weight values pretty for display
        value.predictions[0].probability = Math.round(value.predictions[0].probability * 1000) / 10
        value.predictions[1].probability = Math.round(value.predictions[1].probability * 1000) / 10

        if (value.predictions[0].hasOwnProperty("explanation_features")) {
            for (let i = 0; i < value.predictions[0].explanation_features.length; i++) {
                value.predictions[0].explanation_features[i].weight = Math.round(value.predictions[0].explanation_features[i].weight * 1000) / 10;
            }
        }

        if (value.predictions[1].hasOwnProperty("explanation_features")) {
            for (let i = 0; i < value.predictions[1].explanation_features.length; i++) {
                value.predictions[1].explanation_features[i].weight = Math.round(value.predictions[1].explanation_features[i].weight * 1000) / 10;
            }
        }

        res.render('explain.hbs', {explanation:value});
    });
});

async function get_token() {
    //use the Cloud API key to authenticate. in a production app we'd cache this and then refresh
    //when necessary, since it's a bit wasteful to get a new token each time we make a call.
    console.log('getting token');
    try {
        const response = await axios({
            url: `https://iam.cloud.ibm.com/identity/token?grant_type=urn:ibm:params:oauth:grant-type:apikey&apikey=${auth.cloud.apikey}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json'
            }
        });
        return await response.data.access_token;
    } catch (error) {
        console.error(error);
    }
}

async function get_last_transaction(token) {
    //this function gets the scoring_id of the last prediction made by the model. we need it to
    //request an explanation.
    console.log(`getting transaction using token ${token}`);
    try {
        const response = await axios({
            url: `https://api.aiopenscale.cloud.ibm.com/v1/data_marts/${auth.openscale.guid}/scoring_transactions?subscription_id=${auth.openscale.subscription}&limit=1`,
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        return await response.data;
    } catch (error) {
        console.error(error);
    }
}

async function request_explanation(token, transaction_id) {
    //send a request to the explanation service. this will start an explanation job and return its ID.
    //for the sake of time and system load, we're just getting the LIME explanation, and not the full
    //contrastive explanation. if you want the contrastive piece, remove the 'cem=false' from the url
    //in the call below.
    console.log(`Requesting explanation of ${transaction_id}`);
    try {
        const response = await axios({
            url: `https://api.aiopenscale.cloud.ibm.com/v1/data_marts/${auth.openscale.guid}/explanation_tasks?cem=false`,
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            data: {
                "scoring_id":transaction_id
            }
        });
        return await response.data.metadata.id;
    } catch (error) {
        console.error(error);
    }
}

async function get_request_status(token, job_id) {
    //get the status of the running explanation job. when it's complete, it will return the full
    //explanation details. we'll need to call this repeatedly, since the explanation service usually
    //takes 10-30 seconds to run.
    console.log(`Getting status of explain job id ${job_id}`);
    try {
        const response = await axios({
            url: `https://api.aiopenscale.cloud.ibm.com/v1/data_marts/${auth.openscale.guid}/explanation_tasks/${job_id}?version=2018-09-17&with_error_details=true`,
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        return await response.data;
    } catch (error) {
        console.error(error);
    }
}

async function delay(ms) {
    //generic promise function so we can wait a set amount of time before we query the explanation
    //job status again.
    return await new Promise(resolve => setTimeout(resolve, ms));
}

async function get_explanation() {
    //step by async step to get our explanation. first we authenticate, then get the ID of the last
    //prediction. next, we request an explanation of the prediction. finally, we check every three
    //seconds to see if the explanation task has finished, then return the final value.
    const token = await get_token();
    const transaction = await get_last_transaction(token);
    const transaction_id = transaction.values[0][transaction.fields.indexOf('scoring_id')];
    const request_id = await request_explanation(token, transaction_id);
    let request_status = 'in_progress';
    let request_output = null;
    while (request_status === 'in_progress') {
        await delay(3000);
        request_output = await get_request_status(token, request_id);
        request_status = request_output.entity.status.state;
    }
    return request_output.entity;
}

async function get_prediction(payload) {
    //getting a prediction value is much simpler than getting an explanation. we just need to
    //authenticate, then send our query to the WML REST endpoint for our model.
    const token = await get_token();
    return await query_wml(token, payload);
}

async function query_wml(token, payload) {
    //format the data so we can send it to our model
    let fields = Object.keys(payload);
    let values = Object.values(payload);

    //convert numerical form values to integers. the form passes them as strings. this doesn't
    //affect our model, which handles the transformation for us, but will break OpenScale's
    //payload logging service unless we get the data types right.
    for (let i = 0; i < values.length; i++) {
        if (!isNaN(Number(values[i]))) {
            values[i] = Number(values[i]);
        }
    }

    console.log(`querying wml`);
    try {
        const response = await axios({
            url: auth.openscale.scoring_url,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Authorization': `Bearer ${token}`,
                'ML-Instance-ID': auth.wml["instance_id"]
            },
            data: {
                "fields": fields,
                "values": [values]
            }
        });
        return await response.data;
    } catch (error) {
        console.error(error);
    }
}

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`App listening at http://localhost:${port}`));