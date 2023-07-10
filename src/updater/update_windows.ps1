while(Get-Process -Name "wow.export" -ErrorAction SilentlyContinue) {
    Start-Sleep -Seconds 0.5
}

if (!(Test-Path -Path "./patch_apply" -PathType Container)) {
    Write-Host "no patch to apply"
    exit
}

Copy-Item -Path "./patch_apply/*" -Destination "./" -Recurse
Remove-Item -Path "./patch_apply" -Force -Recurse
Start-Process -FilePath "./wow.export.exe"