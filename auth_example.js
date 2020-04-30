//this file contains service credentials for your IBM services. replace the variables below
//with your credentials, then rename this file to auth.js prior to pushing to IBM Cloud
module.exports = {
    cloud: {
        apikey: "xxxxxPASTE HERExxxxx"
    },
    wml: {
        "apikey": "key",
        "iam_apikey_description": "description",
        "iam_apikey_name": "auto-generated-apikey",
        "iam_role_crn": "crn:v1:bluemix:public:iam::::serviceRole:Writer",
        "iam_serviceid_crn": "crn:v1:bluemix:public:iam-identity::",
        "instance_id": "instance_id",
        "url": "https://us-south.ml.cloud.ibm.com",
    },
    openscale: {
        guid: "xxxxxxxxxxxxxxxxxxxxxx",
        subscription: "xxxxxxx-xxxxxxx-xxxxxxx",
        scoring_url: "https://us-south.ml.cloud.ibm.com/v3/wml_instances/xxxxx/deployments/xxxxx/online"
    }
};