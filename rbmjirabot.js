var JiraIntegration = require('./integrations/jira');
var ChallongeIntegration = require('./integrations/challonge');
var config = require('./config/config');

(function() {
    var Slack = require('./slack/client');
    var f = require('./functions');
    var Log = require('Log');
    var later = require('later');

    var RbmBot = function() {
        this.config = {};
        this.slack = new Slack(process.env.SLACK_BOT_TOKEN || this.config.token, true, true); // token, autoreconnect, automark (whatever that is)
        this.logger = new Log('info');

        this.integrations = [];
        this.ready = false;

        this.slack.login();
        this.init();
    }

    RbmBot.prototype = {
        init: function() {
            this.addIntegration(new JiraIntegration(this));
            this.addIntegration(new ChallongeIntegration(this));
            this.slack.on('open', this.onOpen.bind(this));
            this.slack.on('error', this.onError.bind(this));
        },

        addIntegration: function(integration) {
            this.integrations.push(integration);
            if (integration.init) integration.init();
            this.logger.info("added integration {0}".format(integration.name));
        },

        initChallongeCron: function() {
            
        },

        onOpen: function() {
            var channel = null,
                group = null,
                id = null,
                channels = [], 
                groups = [],
                messages, 
                unreads = this.slack.getUnreadCount();

            this.channels = (function() {
                var ref = this.slack.channels;
                var results = [];
                for (id in ref) {
                    channel = ref[id];

                    if (channel.is_member) {
                        results.push("#" + channel.name);
                    }
                }

                return results;
            }.bind(this))();

            this.groups = (function() {
                var ref = this.slack.groups;
                var results = [];

                for (id in ref) {
                    group = ref[id];

                    if (group.is_open && !group.is_archived) {
                        results.push(group.name);
                    }
                }

                return results;
            }.bind(this))();   

            this.ready = true;
            this.logger.info("Welcome @{0}".format(this.slack.self.name));
        },

        onError: function(error) {
            console.log(error);
            this.logger.error("something went wrong: {0}".format(error.message));
        }    
    }

    var rbmbot = new RbmBot();
}).call(this);