<img width="525" alt="logo-iobroker-oepl_5" src="https://github.com/DrozmotiX/iobroker.open-epaper-link/assets/3323812/d566aae2-1115-4113-8890-fd9c2549d051">

# ioBroker.open-epaper-link

[![NPM version](https://img.shields.io/npm/v/iobroker.open-epaper-link.svg)](https://www.npmjs.com/package/iobroker.open-epaper-link)
[![Downloads](https://img.shields.io/npm/dm/iobroker.open-epaper-link.svg)](https://www.npmjs.com/package/iobroker.open-epaper-link)
![Number of Installations](https://iobroker.live/badges/open-epaper-link-installed.svg)
![Current version in stable repository](https://iobroker.live/badges/open-epaper-link-stable.svg)

[![NPM](https://nodei.co/npm/iobroker.open-epaper-link.png?downloads=true)](https://nodei.co/npm/iobroker.open-epaper-link/)

**Tests:** ![Test and Release](https://github.com/DrozmotiX/ioBroker.open-epaper-link/workflows/Test%20and%20Release/badge.svg)

## open-epaper-link adapter for ioBroker

Alternative firmware and protocol for the ZBS243-based Electronic Shelf Labels - ESL / price tags by Solum / Samsung. It can be used to setup E-Paper tags and supply them with content.
See GitHub Project https://github.com/jjwbruijn/OpenEPaperLink

![image](https://github.com/DrozmotiX/iobroker.open-epaper-link/assets/3323812/7670ef2b-ab15-47c0-8bf8-dc70a9bdbf32)

The adapter facilitates communication between the OEPL Access Point and ioBroker to seamlessly integrate and interact. The resources offer crucial insights for efficient system operation.

It integrates all OpenEPaperLink displays and Access Points into the iobroker object structure, organizing them based on their MAC addresses.

Within the ioBroker system, a central "openepaperlink" folder groups all connected devices, each with its unique structure for targeted management.

This integration ensures a clear representation of all OpenEPaperLink devices in the ioBroker system, allowing efficient management and control through the ioBroker interface. 

This fork is actively maintained and currently in work in progress status. The focus is on reliable tag synchronization, periodic refresh, and write-back features for tag payloads.

**For more information about OpenEPaperLink, valuable insights can be found at:**

https://www.openepaperlink.de and https://github.com/jjwbruijn/OpenEPaperLink

**Additionally, comprehensive tutorials and demonstrations about OpenEPaperLink are available in various YouTube videos by ATC1441, including:**

https://www.youtube.com/watch?v=Etonkolz9Bs and https://www.youtube.com/watch?v=98fOzZs__fc

These resources offer a wealth of information and guidance on understanding and utilizing OpenEPaperLink effectively.

> [!WARNING] Development status
> This fork is work in progress. Core tag synchronization is available, and the adapter is being extended with additional write-back features.

## Write-back support

Each tag now gets a writable `JSONUpload` state below its channel. Write a valid JSON string to that state and the adapter sends it to the matching access point via `POST /jsonupload` with the `mac` and `json` form parameters.

Example:

```json
{"text":"Hello from ioBroker"}
```

## Changelog
<!--
	Placeholder for the next version (at the beginning of the line):
	### **WORK IN PROGRESS**
-->

### **WORK IN PROGRESS**
* (NewXtSI) Maintain the fork and extend the adapter with periodic tag sync and JSON upload write-back
* (NewXtSI) Add per-tag `JSONUpload` state for AP push
* (DutchmanNL) Ensure correct folder root for tag states

### 0.1.0 (2023-11-26)
* (ticaki / DutchmanNL) initial release
* (DutchmanNL) Connect to Access Points and receive their data
* (DutchmanNL) Object structure to reflect Access Points and their connected tags

## License
MIT License

Copyright (c) 2023 DutchmanNL <oss@DrozmotiX.eu>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
