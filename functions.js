String.prototype.format = function() {
    var formatted = this;

    if (arguments.length == 1 && typeof arguments[0] == 'object') {
    	arguments = arguments[0];
    } 

    for (var arg in arguments) {
    	while (formatted.indexOf("{" + arg + "}") != -1) {
    		formatted = formatted.replace("{" + arg + "}", arguments[arg]);
    	}
    }

    return formatted;
}