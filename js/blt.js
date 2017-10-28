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
			serverState.iperfFlows.push({source: "n/a", destination: "n/a", port: "n/a", transport: "n/a", bandwidth: "n/a"});
			displayServerState();
			break;
		case "ping-table":
			serverState.pingFlows.push({source: "n/a", destination: "n/a", intervalType: "n/a", intervalMS: "n/a", packetSize: "n/a"});
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
	iperfTable.innerHTML = "";
	for (i = 0; i < serverState.iperfFlows.length; i++) {
		var flow = serverState.iperfFlows[i];
		var newRow = iperfTable.insertRow(iperfTable.rows.length);
		/* we use the "editable" class to put input event listeners,
		 * and the other classes to easily discern in the common
		 * listener which field was changed */
		newRow.innerHTML =
			"<td contenteditable=\"true\" class=\"editable iperf-source\">" + flow.source + "</td>" +
			"<td contenteditable=\"true\" class=\"editable iperf-destination\">" + flow.destination + "</td>" +
			"<td contenteditable=\"true\" class=\"editable iperf-port\">" + flow.port + "</td>" +
			"<td contenteditable=\"true\" class=\"editable iperf-transport\">" + flow.transport + "</td>" +
			"<td contenteditable=\"true\" class=\"editable iperf-bandwidth\">" + flow.bandwidth + "</td>" +
			"<td><button type=\"button\" class=\"btnRemove\">-</button></td>"
			;
	}
	pingTable.innerHTML = "";
	for (i = 0; i < serverState.pingFlows.length; i++) {
		var flow = serverState.pingFlows[i];
		var newRow = pingTable.insertRow(pingTable.rows.length);
		newRow.innerHTML =
			"<td contenteditable=\"true\" class=\"editable ping-source\">" + flow.source + "</td>" +
			"<td contenteditable=\"true\" class=\"editable ping-destination\">" + flow.destination + "</td>" +
			"<td contenteditable=\"true\" class=\"editable ping-interval-type\">" + flow.intervalType + "</td>" +
			"<td contenteditable=\"true\" class=\"editable ping-interval-ms\">" + flow.intervalMS + "</td>" +
			"<td contenteditable=\"true\" class=\"editable ping-packet-size\">" + flow.packetSize + "</td>" +
			"<td><button type=\"button\" class=\"btnRemove\">-</button></td>"
			;
	}
	/* Put listeners again on DOM objects */
	var btnsAdd = document.getElementsByClassName("btnAdd");
	for (i = 0; i < btnsAdd.length; i++) {
		btnsAdd[i].onclick = addFlow;
	}
	var btnsRemove = document.getElementsByClassName("btnRemove");
	for (i = 0; i < btnsRemove.length; i++) {
		btnsRemove[i].onclick = removeFlow;
	}
	var editables = document.getElementsByClassName("editable");
	for (i = 0; i < editables.length; i++) {
		editables[i].oninput = changeFlow;
	}
}

function xchgServerState(requestType) {
	/* requestType is GET or POST */
	var xhr = new XMLHttpRequest();
	xhr.open(requestType, "blt.php");
	xhr.setRequestHeader("Content-Type", "application/json; charset=UTF-8");
	xhr.onreadystatechange = function() {
		if (this.readyState == 4 && this.status == 200) {
			try {
				serverState = JSON.parse(this.responseText);
				displayServerState();
			} catch (e) {
				window.alert(e.name + " while parsing JSON \"" +
				             this.responseText + "\" from server: " +
				             e.message);
			}
		}
	};
	if (requestType == "POST") {
		xhr.send(JSON.stringify(serverState));
	} else if (requestType == "GET") {
		xhr.send();
	}
	btnSave.disabled = true;
}

function sendServerState() {
	xchgServerState("POST");
}

function getServerState() {
	xchgServerState("GET");
}

getServerState();

btnSave.onclick = sendServerState;
