// Entry point so `node --test extensions/go-rates/test` works on Node 22+,
// where a directory argument is resolved as a module (this file) rather than
// scanned. `node --test extensions/go-rates/test/*.test.js` also works.
"use strict"
require("./plan.test.js")
require("./extract.test.js")
require("./manifest.test.js")
