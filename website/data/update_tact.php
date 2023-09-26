<?php
	if (php_sapi_name() == "cli")
	{
		file_put_contents(__DIR__ . "/tact/wow.tmp", fopen("https://raw.githubusercontent.com/wowdev/TACTKeys/master/WoW.txt", 'r'));
		rename(__DIR__ . "/tact/wow.tmp", __DIR__ . "/tact/wow");
	}
	else
	{
		http_response_code(403);
	}