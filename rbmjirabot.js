var config = require('./config');
var jira = require('./jira');

(function() {
    var Slack = require('./slack/client');
    var request = require('request');
    var extend = require('extend');
    var f = require('./functions');
    var Log = require('Log');
    var btoa = require('btoa');

    var RbmBot = function() {
        this.slack = new Slack(process.env.SLACK_BOT_TOKEN, true, true); // token, autoreconnect, automark (whatever that is)

        this.recentIssues = [];

        this.logger = new Log('info');
        this.init();
    }

    RbmBot.prototype = {
        init: function() {
            this.slack.on('open', this.onOpen.bind(this));
            this.slack.on('message', this.onMessage.bind(this));
            this.slack.on('error', this.onError.bind(this));
            this.slack.login();
        },

        onOpen: function() {
            var channel = null,
                group = null,
                id = null,
                channels = [], 
                groups = [],
                messages, 
                unreads = this.slack.getUnreadCount();

            channels = (function() {
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

            groups = (function() {
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

            this.logger.info("Welcome @{0}".format(this.slack.self.name));
        },

        onMessage: function(message) {
            var channel = this.slack.getChannelGroupOrDMByID(message.channel);
            var user = this.slack.getUserByID(message.user);
            var text = message.text;

            if (message.type === 'message' && (text != null) && (channel != null)) {
                regex = new RegExp('((?:' + jira.projects.join('|') + ')(?:-| )?\\d+)', 'ig');

                if (issues = text.match(regex)) {
                    this.logger.info("found {0} in {1}'s comment".format(issues.join(','), user.name));
                    this.fetchJiraInfo(issues, function(completed, failed, skipped) {
                        var responses = [];

                        for (var i = 0; i < completed.length; i++) {
                            var issue = completed[i];

                            var summary = issue.fields.summary || 'no summary';
                            var description = issue.fields.description.trim('\n') || 'no description';
                            var assignee = issue.fields.assignee;
                            var status = issue.fields.status;

                            var description = description.split('\n').join('\n>');
                            console.log(description);
                            var finalDescription = description.substring(0, Math.min(200, description.length));
                            if (finalDescription.length != description.length) finalDescription += '...';

                            responses.push("`{0}`: {1}\n{5}\n>{2}\n\n\n*Assigned to*: {3}\t*Status*: {4}".format(
                                issue.key,
                                summary,
                                finalDescription,
                                assignee ? assignee.displayName : 'Not assigned',
                                status.name,
                                jira.host.format(issue.key)
                            ));
                        }

                        var extra = null;
                        if (failed.length != 0) {
                            extra = "could not find info for [*{0}*]".format(failed.join('*,* '));
                        }

                        if (skipped.length != 0) {
                            if (extra) extra += '\n';
                            else extra = '';

                            extra += "skipped [*{0}*]".format(skipped.join('*,* '));
                        }

                        if (extra) responses.push(extra);
                        
                        channel.send(responses.join('\n----------------------------------------------------\n'));
                    }.bind(this));
                }
            }
        },

        onError: function(error) {
            console.log(error);
            this.logger.error("something went wrong: {0}".format(error.message));
        },

        fetchJiraInfo: function(issues, callback) {
            var completedIssues = [];
            var failedIssues = [];
            var skippedIssues = [];
            var cooldown = 1000 * 60 * 5; // five minutes

            var options =  {
                uri: null,
                baseUrl: jira.api.host,
                auth: {
                    user: config.username,
                    pass: config.password
                }
            };

            for (var i = 0; i < issues.length; i++) {
                var issue = issues[i];

                if (Object.keys(this.recentIssues).indexOf(issue) != -1) {
                    if (this.recentIssues[issue] > (new Date()).getTime() - (cooldown)) {
                        this.logger.info("requested {0} but it's only been {1}/{2} seconds".format(issue,Math.round(((new Date()).getTime() - this.recentIssues[issue])/1000),Math.round(cooldown/1000)));
                        skippedIssues.push(issue);
                        continue; 
                    }

                    delete this.recentIssues[issue];
                } else {
                    this.recentIssues[issue] = (new Date()).getTime();
                }

                options.uri = (jira.api.issue + issue);

                if (options.uri) {
                    var req = request(options, function(error, response, body) {
                        if (!error && response.statusCode == 200) completedIssues.push(JSON.parse(body));
                        else failedIssues.push(issue);

                        if ((completedIssues.length + failedIssues.length + skippedIssues.length) == issues.length && callback) {
                            callback(completedIssues, failedIssues, skippedIssues);
                        }
                    }.bind(this));
                } else {
                    this.logger.info("unknown uri for {0}".format(issue));
                }
            }
        }  
    }

    var rbmbot = new RbmBot();
}).call(this);