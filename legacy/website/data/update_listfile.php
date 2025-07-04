<?php
	if (php_sapi_name() == "cli")
	{
		file_put_contents(__DIR__ . "/listfile/master.tmp", fopen("https://github.com/wowdev/wow-listfile/releases/latest/download/community-listfile.csv", 'r'));
		rename(__DIR__ . "/listfile/master.tmp", __DIR__ . "/listfile/master");
	}
	else
	{
		http_response_code(403);
	}