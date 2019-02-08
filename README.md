# [CompileBot for Telegram](https://t.me/CompileBot)

CompileBot lets you run snippets of code via Telegram in several different languages.

It works in PM or with inline mode. It currently supports these languages:

- C
- C++
- Java
- JavaScript (Node.js)
- Python 2
- Python 3
- Ruby
- PHP 7
- Lua 5.1
- Lua 5.2
- Lua 5.3
- Go

# The Sandbox

Whenever code is sent to the bot for execution, an ephemeral Docker container is spawned. This container is running the image found in the `docker-image` folder. It runs Alpine 3.9 with all the necessary compilers and interpreters to run the code sent to the bot. In addition, the container has extra restrictions:

- Limited amount of RAM (64MB)
- Limited amount of PIDs (100)
- [gvisor](https://github.com/google/gvisor) container runtime
- No virtual network card attached
- 20 second execution time limit

This allows arbitrary code to be safely run within the container without having access to host resources.

# Donation

If you'd like to donate to this project, you can do so via [Cash App](https://cash.app/$tjhorner) or [PayPal](https://paypal.me/tjhorner). Any donations are much appreciated.

# Development

Instructions on development and building coming soon.

# License

This software is licensed under the GNU GPL, version 3.0.

This means if you make modifications, you must publish your source code, as well as under the same license.

You can read a short summary of the license [here](https://choosealicense.com/licenses/gpl-3.0/).

```
CompileBot for Telegram
Copyright (C) 2018-2019 TJ Horner

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.
```