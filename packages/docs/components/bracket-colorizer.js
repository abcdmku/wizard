// Bracket Rainbow Colorizer
// Wraps { [ } ] brackets in colored spans for nesting visualization

function colorizeCodeBrackets() {
  try {
    // Find all code blocks
    const codeBlocks = document.querySelectorAll('pre code');

    codeBlocks.forEach(codeBlock => {
      // Skip if already processed
      if (codeBlock.dataset.bracketsColorized) return;

      let bracketDepth = 0;
      const bracketColors = ['bracket-level-1', 'bracket-level-2', 'bracket-level-3'];

      // Process the HTML content directly
      const originalHTML = codeBlock.innerHTML;

      // Use regex to find and replace brackets while preserving other HTML
      const processedHTML = originalHTML.replace(/([{}\[\]])/g, (match, bracket) => {
        let colorClass;

        if (bracket === '{' || bracket === '[') {
          colorClass = bracketColors[bracketDepth % 3];
          bracketDepth++;
        } else if (bracket === '}' || bracket === ']') {
          bracketDepth = Math.max(0, bracketDepth - 1);
          colorClass = bracketColors[bracketDepth % 3];
        }

        return `<span class="${colorClass}">${bracket}</span>`;
      });

      // Only update if changes were made
      if (processedHTML !== originalHTML) {
        codeBlock.innerHTML = processedHTML;
      }

      // Mark as processed
      codeBlock.dataset.bracketsColorized = 'true';
    });
  } catch (error) {
    console.warn('Bracket colorizer error:', error);
  }
}

// Run on DOM content loaded
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', colorizeCodeBrackets);
  } else {
    colorizeCodeBrackets();
  }

  // Re-run when new content is added (for dynamic content)
  const observer = new MutationObserver((mutations) => {
    let shouldRerun = false;

    mutations.forEach((mutation) => {
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.matches && (node.matches('pre code') || node.querySelector('pre code'))) {
              shouldRerun = true;
            }
          }
        });
      }
    });

    if (shouldRerun) {
      setTimeout(colorizeCodeBrackets, 100);
    }
  });

  if (document.body) {
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }
}

export { colorizeCodeBrackets };