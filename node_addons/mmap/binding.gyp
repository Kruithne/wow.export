{
  "targets": [
    {
      "target_name": "mmap",
      "sources": [
        "src/mmap_addon.cpp",
        "src/mmap_wrapper.cpp"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "cflags!": ["-fno-exceptions"],
      "cflags_cc!": ["-fno-exceptions"],
      "defines": [
        "NAPI_DISABLE_CPP_EXCEPTIONS"
      ],
      "conditions": [
        ["OS=='win'", {
          "defines": [
            "_WIN32_WINNT=0x0600"
          ],
          "msvs_settings": {
            "VCCLCompilerTool": {
              "ExceptionHandling": 1
            }
          }
        }],
        ["OS=='mac'", {
          "cflags_cc": [
            "-std=c++17"
          ],
          "xcode_settings": {
            "OTHER_LDFLAGS!": [
              "-fuse-ld=lld"
            ],
            "OTHER_LDFLAGS": [
              "-Wl,-search_paths_first"
            ]
          }
        }],
        ["OS=='linux'", {
          "cflags_cc": [
            "-std=c++17"
          ]
        }]
      ]
    }
  ]
}