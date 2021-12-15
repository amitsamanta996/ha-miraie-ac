const axios = require('axios')
const HABroker = require('./ha-broker');
const MiraieBroker = require('./miraie-broker');

let log = (message) => {
    //console.log(message);
};

const constants = {
    httpClientId: 'PBcMcfG19njNCL8AOgvRzIC8AjQa',
    loginUrl: 'https://auth.miraie.in/simplifi/v1/userManagement/login',
    homesUrl: 'https://app.miraie.in/simplifi/v1/homeManagement/homes',
    mirAIeBrokerHost: 'mqtt.miraie.in',
    mirAIeBrokerPort: 8883,
    userCleanSession: false,
};

const settings = {};
let miraieHome;
let haBroker;
let miraieBroker;

const getFormattedName = (name) => name.toLowerCase().replace(/\s/g, '-');

const getScope = () => `an_${Math.floor(Math.random() * 1000000000)}`;

const parseLoginResponse = (resp) => new Promise((resolve, reject) => {
    if (resp && resp.data && resp.data.userId && resp.data.accessToken) {
        log("Login successful!");
        resolve({
            userId: resp.data.userId,
            accessToken: resp.data.accessToken
        });
    } else {
        reject('Unable to parse login response.');
    }
});

const parseHomeDetails = (data, accessToken) => {
    const homeId = data.homeId
    const devices = [];

    data.spaces.map(s => {
        const devicesInSpace = s.devices.map(d => {
            const deviceName = getFormattedName(d.deviceName);
            const device = {
                id: d.deviceId,
                name: deviceName,
                friendlyName: d.deviceName,
                controlTopic: d.topic ? `${d.topic[0]}/control` : null,
                statusTopic: d.topic ? `${d.topic[0]}/status` : null,
                haStatusTopic: `miraie-ac/${deviceName}/state`,
                haAvailabilityTopic: `miraie-ac/${deviceName}/availability`,
                haActionTopic: `miraie-ac/${deviceName}/action`,
                haCommandTopic: `miraie-ac/${deviceName}/+/set`
            };

            return device;
        });

        devices.push(...devicesInSpace);
    });

    log(`Discovered ${devices.length} devices`);
    return {
        homeId,
        accessToken,
        devices
    };
};

const onMiraieStateChanged = (topic, payload) => {
    const device = miraieHome.devices.find(d => d.statusTopic === topic);
    if (device) {
        log(`Device status changed. Device: ${device.friendlyName}`);
        haBroker.publish(device, payload.toString());
    }
};

const onHACommandReceieved = (topic, payload) => {
    const device = miraieHome.devices.find(d => topic.startsWith(`miraie-ac/${d.name}/`));
    if (device) {
        log(`Command receieved for Device: ${device.friendlyName}`);
        miraieBroker.publish(device, payload.toString(), topic);
    }
};

const connectBrokers = (homeDetails) => {
    miraieHome = homeDetails;
    const miraieTopics = miraieHome.devices.map(d => d.statusTopic);

    haBroker = new HABroker(miraieHome.devices, onHACommandReceieved);
    miraieBroker = new MiraieBroker(miraieTopics, onMiraieStateChanged);

    haBroker.connect(settings);
    miraieBroker.connect(constants, homeDetails.homeId, homeDetails.accessToken);

    return new Promise(resolve => resolve({}));
};

const login = (mobile, password) => {
    return axios
        .post(constants.loginUrl, {
            mobile,
            password,
            clientId: constants.httpClientId,
            scope: getScope()
        })
        .then(resp => parseLoginResponse(resp))
        .catch(e => {
            throw new Error('Error logging in. ' + e);
        });
};

const getHomeDetails = (accessToken) => {
    const config = {
        headers: {
            Authorization: `Bearer ${accessToken}`
        }
    };

    return axios
        .get(constants.homesUrl, config)
        .then(resp => {
            if (resp.data && resp.data.length) {
                return parseHomeDetails(resp.data[0], accessToken);
            }

            throw new Error('No devices added');
        });
};

module.exports = function (RED) {
    function MirAIeNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        settings.mobile = this.credentials.mobile;
        settings.password = this.credentials.password;
        settings.haBrokerHost = config.haBrokerHost;
        settings.haBrokerPort = config.haBrokerPort;
        settings.haBrokerUsername = this.credentials.haBrokerUsername;
        settings.haBrokerPassword = this.credentials.haBrokerPassword;
        settings.useCleanSession = config.useCleanSession;
        settings.useSsl = config.useSsl;


        console.log(JSON.stringify(settings));

        login(this.credentials.mobile, this.credentials.password)
            .then(userDetiails => getHomeDetails(userDetiails.accessToken))
            .then(homeDetails => connectBrokers(homeDetails))
            .catch(e => {
                node.error(e);
            });
    }

    RED.nodes.registerType("ha-miraie-ac", MirAIeNode, {
        credentials: {
            mobile: { type: "text" },
            password: { type: "password" },
            haBrokerUsername: { type: "text" },
            haBrokerPassword: { type: "password" },
        }
    });
}