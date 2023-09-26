<?php
	if (isset($_GET['def'])) {
		header('Content-Type: text/plain');
		$def = $_GET['def'];

		if ($def === 'manifest')
			echo file_get_contents('https://raw.githubusercontent.com/wowdev/WoWDBDefs/master/manifest.json');
		else
			echo file_get_contents(sprintf('https://raw.githubusercontent.com/wowdev/WoWDBDefs/master/definitions/%s.dbd', $_GET['def']));
	} else {
		http_response_code(404);
	}