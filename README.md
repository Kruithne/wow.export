<p align="center"><img src="resources/docs/logo_github.png"/></p>

<p align="center">
<a href="https://discord.gg/kC3EzAYBtf"><img src="resources/docs/button_discord.png" alt="Get Help on Discord"></a> 
<a href="https://www.patreon.com/kruithne"><img src="resources/docs/button_patreon.png" alt="Support on Patreon"></a> 
<a href="https://github.com/Kruithne/wow.export/issues"><img src="resources/docs/button_gh.png" alt="Submit Feedback/Issues"></a>
</p>

# 📦 wow.export
wow.export is a full-featured tool for extracting and converting files from game World of Warcraft to commonly used formats.

This project is originally based on WoW Export Tools by [Marlamin](https://github.com/Marlamin).

<p align="center">
<img src="https://www.kruithne.net/wow.export/images/screenshot_1.png" width=45% alt="Screenshot showing the models tab">
<img src="https://www.kruithne.net/wow.export/images/screenshot_2.png" width=45% alt="Screenshot showing the textures tab">
<img src="https://www.kruithne.net/wow.export/images/screenshot_3.png" width=45% alt="Screenshot showing the map tab">
<img src="https://www.kruithne.net/wow.export/images/screenshot_4.png" width=45% alt="Screenshot showing the model tab with a skinned NPC">
</p>

## Let's Go! 🚀
To get started, head over to [our website](https://www.kruithne.net/wow.export) or the [releases](https://github.com/Kruithne/wow.export/releases) page here on GitHub and download the latest version.

If you have World of Warcraft installed, use the `Local Installation` option and point it to the root of your game installation. You'll then be able to choose from a list of versions you have installed, such as Retail or Classic.

If you don't have World of Warcraft installed, you can choose the `Use Blizzard CDN` option. Choose your region and then select from a list of available builds.

You're good to go! If we release an update, you'll be prompted to install it the next time you open wow.export. Be sure to update regularly to ensure you have the latest features and bug fixes.

## Frequently Asked Questions 🤔

### I'm getting a CASC error when trying to load an installation!
90% of CASC-related issues can be solved by opening up the Battle.net launcher and repairing your game installation. Ensure wow.export is closed while you do this.

If this does not resolve your issue, head over to our Discord and ask for help in the `#wow-export` channel. Be sure to post your **runtime log**.

### Where do I find the runtime log?
The runtime log is located at `%LocalAppData%\wow.export\User Data\Default\runtime.log`. You should provide this on Discord when asking for help!

### Can I use wow.export with older versions of World of Warcraft?
We don't prevent you from using wow.export with older versions of World of Warcraft, but we only officially support the latest builds available. You may run into issues!

### Can I use wow.export with non-official versions of World of Warcraft?
We do not support the use of wow.export with non-official versions of World of Warcraft. This includes private servers, custom builds, and other unofficial versions of the game.

Versions of World of Warcraft before Warlords of Draenor use the legacy MPQ file system which is currently not supported in any capacity.

### Can I use wow.export with World of Warcraft Classic?
Yes, you can use wow.export with the latest versions of World of Warcraft Classic. This includes Classic, Burning Crusade Classic, and Wrath of the Lich King Classic.

### Can I export animations/armature?
Currently we do not have support for exporting animations/armature, but this is coming soon in a future update when we add GLTF support.

### Can I export models in the FBX format?
No, we do not support the FBX format and have no plans to so in the future. We recommend using [Blender](https://www.blender.org/) to convert models to FBX if necessary.

### Can I view/export files from other locales?
Yes, select `Manage Settings` from the top-right menu and change the `CASC Locale` option to the desired locale.

### I can't find the model/texture/etc I'm looking for!
File names are not accessible in the game client, so we rely on [the community](https://github.com/wowdev/wow-listfile) to provide them. Often when new content is added, it can take some time for them to be added to the listfile.

You can explore files that haven't been named by selecting `Browse Raw Client Files` from the top-right menu and searching for `unknown` in the search bar.

### Why are character models missing textures?
We currently don't support the customization of character models, however we do have plans to add this in a future update.

### Why are my textures all see-through?
Textures from World of Warcraft often carry non-transparency related data in the alpha channel of the images. This is not supported by many image viewers and 3D software, and can cause the texture to appear see-through.

To fix this, disable the alpha channel of the texture. Our Blender add-on will do this automatically for you if you uncheck the `Use Alpha` option on the import window.

### Why do my textures have black spots/artifacts on them?
If you're seeing black spots or artifacts on your textures, then the software you are using is applying an optimization called [alpha premultiplcation](https://microsoft.github.io/Win2D/WinUI3/html/PremultipliedAlpha.htm) to the texture.

In Blender, you can disable this by setting the `Alpha Mode` of the `Image Texture` node in the shader editor to `CHANNEL_PACKED`. If you've used our Blender add-on, this will be done automatically for you.

### Why can't I find the game executables?
Files such as the executables are not part of the game data. You can find these files by selecting `Browser Install Manifest` from the top-right menu.

## Legal Stuff 📜
wow.export is not affiliated with Blizzard Entertainment in any way. World of Warcraft and Blizzard Entertainment are trademarks or registered trademarks of Blizzard Entertainment, Inc. in the U.S. and/or other countries.

wow.export is licensed under the MIT license. See the [LICENSE](LICENSE) file for more information on this license and a list of licenses for third-party libraries used in this project.