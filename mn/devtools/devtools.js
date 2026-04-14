// Create the "Machines" panel in Chrome DevTools.
// Only creates the panel if MachineNative is detected on the page.
chrome.devtools.inspectedWindow.eval(
  'typeof MachineNative !== "undefined"',
  function (hasMN) {
    if (hasMN) {
      chrome.devtools.panels.create('Machines', '', 'panel.html');
    }
  }
);
