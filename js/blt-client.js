var btnSave = document.getElementById("btnSave");
var btnStartStop = document.getElementById("btnStartStop");

var serverState;

/* Type of e is InputEvent.
 * Type of e.target is HTMLTableCellElement. */
function changeFlow(e) {
	var parentRow = e.target;
	var text = e.target.innerHTML;
	while (parentRow.nodeName.toLowerCase() != "tr") {
		parentRow = parentRow.parentElement;
	}
	var classes = e.target.classList;
	var index = parentRow.rowIndex - 1;
	if (classes.contains("iperf-source")) {
		serverState.iperfFlows[index].source = text;
	} else if (classes.contains("iperf-destination")) {
		serverState.iperfFlows[index].destination = text;
	} else if (classes.contains("iperf-port")) {
		serverState.iperfFlows[index].port = text;
	} else if (classes.contains("iperf-transport")) {
		serverState.iperfFlows[index].transport = text;
	} else if (classes.contains("iperf-bandwidth")) {
		serverState.iperfFlows[index].bandwidth = text;
	} else if (classes.contains("iperf-enabled")) {
		serverState.iperfFlows[index].enabled = e.target.checked;
	} else if (classes.contains("ping-source")) {
		serverState.pingFlows[index].source = text;
	} else if (classes.contains("ping-destination")) {
		serverState.pingFlows[index].source = text;
	} else if (classes.contains("ping-interval-type")) {
		serverState.pingFlows[index].intervalType = text;
	} else if (classes.contains("ping-interval-ms")) {
		serverState.pingFlows[index].intervalMS = text;
	} else if (classes.contains("ping-packet-size")) {
		serverState.pingFlows[index].packetSize = text;
	} else if (classes.contains("ping-enabled")) {
		serverState.pingFlows[index].enabled = e.target.checked;
	} else {
		window.alert("unrecognized change operation: row " + index +
		             ", text " + text + ", class list " + classes);
		return;
	}
	btnSave.disabled = false;
}

function addFlow() {
	var parentTable = this;
	while (parentTable.nodeName.toLowerCase() != "table") {
		parentTable = parentTable.parentElement;
		/* TODO: check case where there is no parent node element of type "table" */
	}
	switch (parentTable.id) {
		case "iperf-table":
			serverState.iperfFlows.push({source: "n/a", destination: "n/a", port: "n/a", transport: "n/a", bandwidth: "n/a", enabled: false});
			displayServerState();
			break;
		case "ping-table":
			serverState.pingFlows.push({source: "n/a", destination: "n/a", intervalType: "n/a", intervalMS: "n/a", packetSize: "n/a", enabled: false});
			displayServerState();
			break;
		default:
			window.alert("Invalid selection!");
			return;
	}
	btnSave.disabled = false;
}

function removeFlow() {
	var parentTable = this;
	while (parentTable.nodeName.toLowerCase() != "table") {
		parentTable = parentTable.parentElement;
		/* TODO: check case where there is no parent node element of type "table" */
	}
	var parentRow = this;
	while (parentRow.nodeName.toLowerCase() != "tr") {
		parentRow = parentRow.parentElement;
	}
	var indexToRemove = parentRow.rowIndex - 1;
	var flows;
	switch (parentTable.id) {
		case "iperf-table":
			flows = serverState.iperfFlows;
			break;
		case "ping-table":
			flows = serverState.pingFlows;
			break;
		default:
			window.alert("Invalid selection!");
			return;
	}
	if (indexToRemove < 0 || indexToRemove >= flows.length) {
		window.alert("cannot remove index " + indexToRemove +
		             " from flow array");
		return;
	}
	flows.splice(indexToRemove, 1);
	displayServerState();
	btnSave.disabled = false;
}

function displayServerState() {
	var iperfTable = document.getElementById("iperf-table").getElementsByTagName('tbody')[0];;
	var  pingTable = document.getElementById("ping-table").getElementsByTagName('tbody')[0];;
	var   editable = serverState.trafficRunning ? "" : "contenteditable";

	iperfTable.innerHTML = "";
	for (i = 0; i < serverState.iperfFlows.length; i++) {
		var flow = serverState.iperfFlows[i];
		var newRow = iperfTable.insertRow(iperfTable.rows.length);
		/* we use the "editable" class to put input event listeners,
		 * and the other classes to easily discern in the common
		 * listener which field was changed */
		newRow.innerHTML =
			"<td><input type=\"checkbox\" class=\"editable iperf-enabled\"" +
				(flow.enabled ? " checked" : "") + (serverState.trafficRunning ? " disabled" : "") + "></td>" +
			"<td " + editable + " class=\"editable iperf-source\">" + flow.source + "</td>" +
			"<td " + editable + " class=\"editable iperf-destination\">" + flow.destination + "</td>" +
			"<td " + editable + " class=\"editable iperf-port\">" + flow.port + "</td>" +
			"<td " + editable + " class=\"editable iperf-transport\">" + flow.transport + "</td>" +
			"<td " + editable + " class=\"editable iperf-bandwidth\">" + flow.bandwidth + "</td>" +
			"<td><button type=\"button\" class=\"btnRemove\">-</button></td>"
			;
	}
	pingTable.innerHTML = "";
	for (i = 0; i < serverState.pingFlows.length; i++) {
		var flow = serverState.pingFlows[i];
		var newRow = pingTable.insertRow(pingTable.rows.length);
		newRow.innerHTML =
			"<td><input type=\"checkbox\" class=\"editable ping-enabled\"" +
				(flow.enabled ? " checked" : "") + (serverState.trafficRunning ? " disabled" : "") + "></td>" +
			"<td " + editable + " class=\"editable ping-source\">" + flow.source + "</td>" +
			"<td " + editable + " class=\"editable ping-destination\">" + flow.destination + "</td>" +
			"<td " + editable + " class=\"editable ping-interval-type\">" + flow.intervalType + "</td>" +
			"<td " + editable + " class=\"editable ping-interval-ms\">" + flow.intervalMS + "</td>" +
			"<td " + editable + " class=\"editable ping-packet-size\">" + flow.packetSize + "</td>" +
			"<td><button type=\"button\" class=\"btnRemove\">-</button></td>"
			;
	}
	/* Put listeners again on DOM objects */
	var btnsAdd = document.getElementsByClassName("btnAdd");
	for (i = 0; i < btnsAdd.length; i++) {
		btnsAdd[i].onclick = addFlow;
		btnsAdd[i].disabled = serverState.trafficRunning;
	}
	var btnsRemove = document.getElementsByClassName("btnRemove");
	for (i = 0; i < btnsRemove.length; i++) {
		btnsRemove[i].onclick = removeFlow;
		btnsRemove[i].disabled = serverState.trafficRunning;
	}
	var editables = document.getElementsByClassName("editable");
	for (i = 0; i < editables.length; i++) {
		editables[i].oninput = changeFlow;
		editables[i].disabled = serverState.trafficRunning;
	}
}

function xchgServerRunningState(requestType) {
	/* requestType is GET or PUT */
	var xhr = new XMLHttpRequest();
	xhr.open(requestType, "/running");
	xhr.setRequestHeader("Content-Type", "text/plain; charset=UTF-8");
	xhr.onreadystatechange = function() {
		if (this.readyState == 4 && this.status == 200) {
			/* Expecting to find running state of server traffic */
			switch (this.responseText) {
			case "true":
				serverState.trafficRunning = true;
				break;
			case "false":
				serverState.trafficRunning = false;
				break;
			default:
				window.alert("Invalid running state received from server: " + serverState);
				return;
			}
			btnStartStop.innerHTML = (serverState.trafficRunning ? "Stop traffic" : "Start traffic");
			displayServerState();
		}
	};
	if (requestType == "PUT") {
		xhr.send(serverState.trafficRunning ? "false" : "true");
	} else if (requestType == "GET") {
		xhr.send();
	}
}

function xchgServerFlows(requestType) {
	/* requestType is GET or PUT */
	var xhr = new XMLHttpRequest();
	xhr.open(requestType, "/flows");
	xhr.setRequestHeader("Content-Type", "application/json; charset=UTF-8");
	xhr.onreadystatechange = function() {
		if (this.readyState != 4) return;
		switch (this.status) {
		case 200:
			try {
				serverState = JSON.parse(this.responseText);
				displayServerState();
				btnSave.disabled = true;
			} catch (e) {
				window.alert(e.name + " while parsing JSON \"" +
				             this.responseText + "\" from server: " +
				             e.message);
			}
			break;
		case 405:
			window.alert("Not allowed to change flow configuration while traffic is running!");
			break;
		default:
			window.alert("Changing flows resulted in server error code " + this.status);
		}
	};
	if (requestType == "PUT") {
		xhr.send(JSON.stringify(serverState));
	} else if (requestType == "GET") {
		xhr.send();
	}
}

window.onload = function() {
	xchgServerFlows("GET");
	xchgServerRunningState("GET");
};
btnSave.onclick = function() {
	xchgServerFlows("PUT");
};
btnStartStop.onclick = function() {
	xchgServerRunningState("PUT");
};
