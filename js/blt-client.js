var btnSave = document.getElementById("btnSave");
var btnStartStop = document.getElementById("btnStartStop");

var serverState = {
	running: false,
	flows: {
		iperf: [],
		ping: [],
	}
};

/* Type of e is InputEvent.
 * Type of e.target is HTMLTableCellElement. */
function changeFlow(e) {
	var parentRow = e.target;
	var text = e.target.innerText.trim();
	while (parentRow.nodeName.toLowerCase() != "tr") {
		parentRow = parentRow.parentElement;
	}
	var classes = e.target.classList;
	var index = parentRow.rowIndex - 1;
	if (classes.contains("iperf-source")) {
		serverState.flows.iperf[index].source = text;
	} else if (classes.contains("iperf-destination")) {
		serverState.flows.iperf[index].destination = text;
	} else if (classes.contains("iperf-port")) {
		serverState.flows.iperf[index].port = text;
	} else if (classes.contains("iperf-transport")) {
		serverState.flows.iperf[index].transport = text;
	} else if (classes.contains("iperf-bandwidth")) {
		serverState.flows.iperf[index].bandwidth = text;
	} else if (classes.contains("iperf-label")) {
		serverState.flows.iperf[index].label = text;
	} else if (classes.contains("iperf-enabled")) {
		serverState.flows.iperf[index].enabled = e.target.checked;
	} else if (classes.contains("ping-source")) {
		serverState.flows.ping[index].source = text;
	} else if (classes.contains("ping-destination")) {
		serverState.flows.ping[index].source = text;
	} else if (classes.contains("ping-interval-type")) {
		serverState.flows.ping[index].intervalType = text;
	} else if (classes.contains("ping-interval-ms")) {
		serverState.flows.ping[index].intervalMS = text;
	} else if (classes.contains("ping-packet-size")) {
		serverState.flows.ping[index].packetSize = text;
	} else if (classes.contains("ping-label")) {
		serverState.flows.ping[index].label = text;
	} else if (classes.contains("ping-enabled")) {
		serverState.flows.ping[index].enabled = e.target.checked;
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
		serverState.flows.iperf.push({
			source: "n/a",
			destination: "n/a",
			port: "n/a",
			transport: "n/a",
			bandwidth: "n/a",
			label: "n/a",
			enabled: false
		});
		displayServerState();
		break;
	case "ping-table":
		serverState.flows.ping.push({
			source: "n/a",
			destination: "n/a",
			intervalType: "n/a",
			intervalMS: "n/a",
			packetSize: "n/a",
			label: "n/a",
			enabled: false
		});
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
			flows = serverState.flows.iperf;
			break;
		case "ping-table":
			flows = serverState.flows.ping;
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
	var iperfTable = document.getElementById("iperf-table").getElementsByTagName('tbody')[0];
	var  pingTable = document.getElementById("ping-table").getElementsByTagName('tbody')[0];
	var   editable = serverState.running ? "" : "contenteditable";

	iperfTable.innerHTML = "";
	serverState.flows.iperf.forEach((f) => {
		var newRow = iperfTable.insertRow(iperfTable.rows.length);
		/* we use the "editable" class to put input event listeners,
		 * and the other classes to easily discern in the common
		 * listener which field was changed */
		newRow.innerHTML =
			'<td><input type="checkbox" class="editable iperf-enabled"' +
			(f.enabled ? ' checked' : '') + (serverState.running ? ' disabled' : '') + '></td>' +
			'<td ' + editable + ' class="editable iperf-label">' + f.label + '</td>' +
			'<td ' + editable + ' class="editable iperf-source">' + f.source + '</td>' +
			'<td ' + editable + ' class="editable iperf-destination">' + f.destination + '</td>' +
			'<td ' + editable + ' class="editable iperf-port">' + f.port + '</td>' +
			'<td ' + editable + ' class="editable iperf-transport">' + f.transport + '</td>' +
			'<td ' + editable + ' class="editable iperf-bandwidth">' + f.bandwidth + '</td>' +
			'<td><button type=\"button\" class=\"btnRemove\">-</button></td>'
			;
	});
	pingTable.innerHTML = "";
	serverState.flows.ping.forEach((f) => {
		var newRow = pingTable.insertRow(pingTable.rows.length);
		newRow.innerHTML =
			'<td><input type="checkbox" class="editable ping-enabled"' +
			(f.enabled ? ' checked' : '') + (serverState.running ? ' disabled' : '') + '></td>' +
			'<td ' + editable + ' class="editable ping-label">' + f.label + '</td>' +
			'<td ' + editable + ' class="editable ping-source">' + f.source + '</td>' +
			'<td ' + editable + ' class="editable ping-destination">' + f.destination + '</td>' +
			'<td ' + editable + ' class="editable ping-interval-type">' + f.intervalType + '</td>' +
			'<td ' + editable + ' class="editable ping-interval-ms">' + f.intervalMS + '</td>' +
			'<td ' + editable + ' class="editable ping-packet-size">' + f.packetSize + '</td>' +
			'<td><button type="button" class="btnRemove">-</button></td>'
			;
	});
	/* Put listeners again on DOM objects */
	[].forEach.call(document.getElementsByClassName("btnAdd"), (btnAdd) => {
		btnAdd.onclick = addFlow;
		btnAdd.disabled = serverState.running;
	});
	[].forEach.call(document.getElementsByClassName("btnRemove"), (btnRemove) => {
		btnRemove.onclick = removeFlow;
		btnRemove.disabled = serverState.running;
	});
	[].forEach.call(document.getElementsByClassName("editable"), (editable) => {
		editable.oninput = changeFlow;
		editable.disabled = serverState.running;
	});
	btnStartStop.innerHTML = (serverState.running) ? "Stop traffic" : "Start traffic";
}

function xchgServerState(requestType, path, toSend) {
	return new Promise((resolve, reject) => {
		/* requestType is GET or PUT */
		var xhr = new XMLHttpRequest();
		xhr.open(requestType, path);
		xhr.setRequestHeader("Content-Type", "application/json");
		xhr.onload = function() {
			if (this.status >= 200 && this.status < 300) {
				try {
					resolve(JSON.parse(this.responseText));
				} catch (e) {
					reject(e);
				}
			} else {
				reject(new Error(this.status));
			}
		};
		if (requestType == "PUT") {
			xhr.send(JSON.stringify(toSend));
		} else if (requestType == "GET") {
			xhr.send();
		}
	});
}

function onSSEEvent(event) {
	try {
		var msg = JSON.parse(event.data);
		var dom_node;
		switch (event.type) {
		case "iperf":
			dom_node = document.getElementById("iperf-gnuplot");
			break;
		case "ping":
			dom_node = document.getElementById("ping-gnuplot");
			break;
		default:
			throw new Error("invalid event type " + event.type);
		}
		dom_node.innerHTML = msg.svg;
	} catch (e) {
		window.alert(e.name + ' while parsing event "' + event.data +
		             ' from server: ' + e.message);
	}
}

function initSSE() {
	sseStream = new EventSource("/sse");
	sseStream.onopen = function() {
		console.log("sse :: connection opened");
	};
	sseStream.onerror = function (event) {
		console.log("sse :: connection error");
		console.log(event);
		sseStream.close();
		refresh();
	};
	sseStream.onmessage = function (event) {
		console.log("sse stream message: " + event.data);
	};
	sseStream.onclose = function(code, reason) {
		console.log("sse :: connection closed");
		console.log(code, reason);
	};
	sseStream.addEventListener("iperf", onSSEEvent);
	/* Close the connection when the window is closed */
	window.addEventListener("beforeunload", closeSSE);
}

function closeSSE() {
	if (typeof(sseStream) != "undefined") { sseStream.close(); }
}

function onServerStateChanged(newState) {
	if (typeof (newState.flows) != "undefined") {
		serverState.flows = newState.flows;
	}
	if (typeof (newState.running) != "undefined") {
		if (serverState.running == false && newState.running == true) {
			serverState.running = true;
			initSSE();
		} else if (serverState.running == true && newState.running == false) {
			serverState.running = false;
			closeSSE();
			document.getElementById("iperf-gnuplot").innerHTML = "";
			document.getElementById("ping-gnuplot").innerHTML = "";
		}
	}
	displayServerState();
}

function refresh() {
	Promise.all([
		xchgServerState("GET", "/flows"),
		xchgServerState("GET", "/running")
	])
	.then((array) => {
		onServerStateChanged({
			flows: array[0],
			running: array[1].running
		});
	})
	.catch((reason) => { console.log(reason); });
};

window.onload = refresh;
btnSave.onclick = function() {
	xchgServerState("PUT", "/flows", flows)
	.then((flows) => { onServerStateChanged({flows: flows}); })
	.catch((reason) => { console.log(reason); });
};
btnStartStop.onclick = function() {
	xchgServerState("PUT", "/running", {
		running: !serverState.running
	})
	.then((state) => { onServerStateChanged({ running: state.running }); })
	.catch((reason) => { console.log(reason); });
};
