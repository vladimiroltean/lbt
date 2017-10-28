<?php
header("Content-type:application/json");

error_reporting(E_ALL);
ini_set("display_errors", 1);

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
  $json = file_get_contents('php://input');
  $obj = json_decode($json);
  $fp = @file_put_contents("blt.json", $json);
  if ($fp === FALSE) {
    echo "{\"trafficRunning\": false, \"iperfFlows\":[], \"pingFlows\":[]}";
  } else {
    echo $json;
  }
} else if ($_SERVER['REQUEST_METHOD'] === "GET") {
  $json = @file_get_contents("blt.json");
  if ($json === FALSE) {
    echo "{\"trafficRunning\": false, \"iperfFlows\":[], \"pingFlows\":[]}";
  } else {
    echo $json;
  }
}
?>
