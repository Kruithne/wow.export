{
  "targets": [
    {
      "target_name": "spout",
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "spout"
      ],
      "defines": [
        "NAPI_DISABLE_CPP_EXCEPTIONS"
      ],
      "conditions": [
        ["OS=='win'", {
          "sources": [
            "src/spout_addon.cpp",
            "spout/SpoutDX.cpp",
            "spout/SpoutCopy.cpp",
            "spout/SpoutDirectX.cpp",
            "spout/SpoutFrameCount.cpp",
            "spout/SpoutSenderNames.cpp",
            "spout/SpoutSharedMemory.cpp",
            "spout/SpoutUtils.cpp"
          ],
          "defines": [
            "_WIN32_WINNT=0x0A00"
          ],
          "libraries": [
            "d3d11.lib",
            "dxgi.lib"
          ],
          "msvs_settings": {
            "VCCLCompilerTool": {
              "ExceptionHandling": 1,
              "AdditionalOptions": ["/std:c++17"]
            }
          }
        }]
      ]
    }
  ]
}
