#!/bin/bash

while pgrep -x "wow.export" >/dev/null; do
	sleep 0.5
done

if [ ! -d "./patch_apply" ]; then
    echo "no patch to apply"
    exit
fi

cp -r "./patch_apply"/* "./"
rm -rf "./patch_apply"
chmod +x "./wow.export"
"./wow.export"
