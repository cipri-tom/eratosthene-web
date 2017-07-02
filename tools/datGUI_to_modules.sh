#!/usr/bin/env sh
# Script to convert dat.gui to ES6 modules from https://github.com/dataarts/dat.gui/issues/132#issuecomment-307893879

# use an existing clone of dat.gui (I keep mine in lib)
cd ../lib/dat.gui/src/dat
# convert raw html/css to export default of template string.
sed '
  1s/^/export default `/
  $s/$/`/
' < gui/saveDialogue.html > gui/saveDialogue.js
sed '
  1s/^/export default `/
  $s/$/`/
' < ../../build/dat.gui.css > gui/style.css.js

# Convert module.exports to js export default
cp utils/css.js utils/css0.js
sed '
  s/module.exports =/export default/
' < utils/css0.js > utils/css.js

# update GUI.js to new names
cp gui/GUI.js gui/GUI0.js
sed '
  /import saveDialogueContents/s/.html//
  /import styleSheet/s/scss/css.js/
' < gui/GUI0.js > gui/GUI.js

rollup -f es index.js > ../../../dat.gui.module.js