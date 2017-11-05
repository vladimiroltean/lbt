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
function changeFlow(classes, text) {
	if (classes.contains("source")) {
		this.source = text;
	} else if (classes.contains("destination")) {
		this.destination = text;
	} else if (classes.contains("port")) {
		this.port = text;
	} else if (classes.contains("transport")) {
		this.transport = text;
	} else if (classes.contains("bandwidth")) {
		this.bandwidth = text;
	} else if (classes.contains("label")) {
		this.label = text;
	} else if (classes.contains("flow-enabled")) {
		this.enabled = text;
	} else if (classes.contains("interval-type")) {
		this.intervalType = text;
	} else if (classes.contains("interval-ms")) {
		this.intervalMS = text;
	} else if (classes.contains("packet-size")) {
		this.packetSize = text;
	} else {
		console.log("changeFlow failed: classes %s, text %s",
		            classes, text);
		return;
	}
}

function addFlow(flowType) {
	switch (flowType) {
	case "iperf":
		this.push({
			source: "user@hostname:port",
			destination: "user@hostname:port",
			port: "n/a",
			transport: "tcp",
			bandwidth: "n/a",
			label: "n/a",
			enabled: false
		});
		break;
	case "ping":
		this.push({
			source: "user@hostname:port",
			destination: "user@hostname:port",
			intervalType: "adaptive",
			intervalMS: "n/a",
			packetSize: "n/a",
			label: "n/a",
			enabled: false
		});
		break;
	default:
		console.log("Invalid selection " + flowType);
		return;
	}
}

function removeFlow(indexToRemove) {
	if (indexToRemove < 0 || indexToRemove >= this.length) {
		window.alert("cannot remove index " + indexToRemove +
		             " from flow array");
		return;
	}
	this.splice(indexToRemove, 1);
}

function populateRow(flowType, flow) {
	var inputEditable = serverState.running ? "" : "contenteditable";
	var inputDisabled = serverState.running ? ' disabled' : '';

	/* we use the "editable|checkbox|dropdown" class to put input event listeners,
	 * and the other classes to easily discern in the common
	 * listener which field was changed */
	var flowEnabled = '<td> <input type="checkbox" class="checkbox flow-enabled"' +
		(flow.enabled ? ' checked' : '') + inputDisabled + '></td>';
	var label = '<td ' + inputEditable + ' class="editable label">' + flow.label + '</td>';
	var source = '<td ' + inputEditable + ' class="editable source">' + flow.source + '</td>';
	var destination = '<td ' + inputEditable + ' class="editable destination">' + flow.destination + '</td>';
	var btnRemove = '<td> <button type="button" ' + inputDisabled + ' class="btnRemove">-</button> </td>';
	switch (flowType) {
	case "iperf":
		var port = '<td ' + inputEditable + ' class="editable port">' + flow.port + '</td>';
		var transport = '<td>' +
			'<select ' + inputDisabled + ' class="dropdown transport">' +
			'<option value="udp" ' + ((flow.transport == "udp") ? "selected" : "") + '>UDP</option>' +
			'<option value="tcp" ' + ((flow.transport == "tcp") ? "selected" : "") + '>TCP</option>' +
			'</select>' +
			'</td>';
		var bandwidth = '<td ' + inputEditable + ' class="editable bandwidth">' + flow.bandwidth + '</td>';
		this.innerHTML = flowEnabled + label + source + destination + port + transport + bandwidth + btnRemove;
		break;
	case "ping":
		var intervalType = '<td>' +
			'<select ' + inputDisabled + ' class="dropdown interval-type">' +
			'<option value="periodic" ' + ((flow.intervalType == "periodic") ? "selected" : "") + '>Periodic</option>' +
			'<option value="adaptive" ' + ((flow.intervalType == "adaptive") ? "selected" : "") + '>Adaptive</option>' +
			'<option value="flood" '    + ((flow.intervalType == "flood") ? "selected" : "") + '>Flood</option>' +
			'</select>' +
			'</td>';
		var intervalMS = '<td ' + inputEditable + ' class="editable interval-ms">' + flow.intervalMS + '</td>';
		var packetSize = '<td ' + inputEditable + ' class="editable packet-size">' + flow.packetSize + '</td>';
		this.innerHTML = flowEnabled + label + source + destination + intervalType + intervalMS + packetSize + btnRemove;
		break;
	default:
		console.log("populateRow: invalid flow type " + flowType);
	}
}

function displayServerState() {
	["iperf", "ping"].forEach((flowType) => {
		var table = document.getElementById(flowType + "-table");
		var tbody = table.getElementsByTagName('tbody')[0];
		var flows = (flowType == "iperf") ? serverState.flows.iperf : serverState.flows.ping;

		tbody.innerHTML = "";
		flows.forEach((f) => {
			var newRow = tbody.insertRow(tbody.rows.length);
			populateRow.call(newRow, flowType, f);
		});
		/* Put listeners again on DOM objects */
		[].forEach.call(table.getElementsByClassName("btnAdd"), (btnAdd) => {
			btnAdd.onclick = () => {
				addFlow.call(flows, flowType);
				displayServerState();
				btnSave.disabled = false;
			}
			btnAdd.disabled = serverState.running;
		});
		[].forEach.call(table.getElementsByClassName("btnRemove"), (btnRemove) => {
			btnRemove.onclick = () => {
				var parentRow = this;
				while (parentRow.nodeName.toLowerCase() != "tr") {
					parentRow = parentRow.parentElement;
				}
				removeFlow.call(flows, parentRow.rowIndex - 1);
				displayServerState();
				btnSave.disabled = false;
			};
		});
		["editable", "dropdown", "checkbox"].forEach((cellType) => {
			[].forEach.call(table.getElementsByClassName(cellType), (cell) => {
				cell.oninput = (event) => {
					var classes = event.target.classList;
					var text = cellType == "checkbox" ? event.target.checked :
				           	   cellType == "dropdown" ? event.target.value :
				           	   event.target.innerText.trim();
					var parentRow = event.target;
					while (parentRow.nodeName.toLowerCase() != "tr") {
						parentRow = parentRow.parentElement;
					}
					var index = parentRow.rowIndex - 1;
					changeFlow.call(flows[index], classes, text);
					btnSave.disabled = false;
				}
			});
		});
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
				reject(new Error(this.status + ": " + this.responseText));
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
		if (event.eventPhase == EventSource.CLOSED) {
			/* Server hung up */
			closeSSE();
		} else {
			console.log("sse :: connection error");
			console.log(event);
		}
	};
	sseStream.onmessage = function (event) {
		console.log("sse stream message: " + event.data);
	};
	sseStream.addEventListener("iperf", onSSEEvent);
	sseStream.addEventListener("ping", onSSEEvent);
	/* Close the connection when the window is closed */
	window.addEventListener("beforeunload", closeSSE);
}

function closeSSE() {
	if (typeof(sseStream) != "undefined") {
		console.log("sse :: connection closed");
		sseStream.close();
		refresh();
	}
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
	btnSave.disabled = true;
	console.log(serverState);
	displayServerState();
}

function refresh() {
	Promise.all([
		xchgServerState("GET", "/flows"),
		xchgServerState("GET", "/running")
	])
	.then((array) => {
		onServerStateChanged({
			flows: array[0].flows,
			running: array[1].running
		});
	})
	.catch((reason) => { console.log(reason); });
};

window.onload = () => {
	refresh();
	btnSave.onclick = () => {
		xchgServerState("PUT", "/flows", { flows: serverState.flows })
		.then((state) => { onServerStateChanged({flows: state.flows}); })
		.catch((reason) => { console.log(reason); });
	};
	btnStartStop.onclick = () => {
		xchgServerState("PUT", "/running", {
			running: !serverState.running
		})
		.then((state) => { onServerStateChanged({ running: state.running }); })
		.catch((reason) => { console.log(reason); });
	};
}
