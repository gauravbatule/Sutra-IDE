import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:9222/devtools/page/918708ABDDF5017BFDE81EC1AE7FC1D1');

ws.on('open', () => {
  ws.send(JSON.stringify({ id: 1, method: 'Console.enable' }));
  ws.send(JSON.stringify({ id: 2, method: 'Runtime.enable' }));
  ws.send(JSON.stringify({
    id: 3,
    method: 'Runtime.evaluate',
    params: {
      expression: `
        (() => {
          const store = window.useIDEStore ? window.useIDEStore.getState() : null;
          // In manager mode, we can click the first conversation to leave showGreeting or toggle preview directly
          const firstConvo = document.querySelector('.group.cursor-pointer');
          if (firstConvo) firstConvo.click();
          setTimeout(() => {
            const previewBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Preview') || b.getAttribute('title')?.includes('Preview'));
            if (previewBtn) previewBtn.click();
          }, 300);
          return { hadFirstConvo: Boolean(firstConvo) };
        })()
      `,
      returnByValue: true
    }
  }));
});

ws.on('message', (d) => {
  const msg = JSON.parse(d);
  if (msg.id === 3) {
    console.log('Clicked preview button:', msg.result);
    setTimeout(() => {
      ws.send(JSON.stringify({
        id: 4,
        method: 'Runtime.evaluate',
        params: {
          expression: `
            (() => {
              const iframe = document.querySelector('iframe');
              const text = document.body.innerText;
              const hasUnableToLoad = text.includes('Unable to load preview');
              const hasTookLonger = text.includes('Preview took longer than usual');
              const refreshBtn = document.querySelector('button[title*="Hard Reload"]') || document.querySelector('button[title*="Reload Viewport"]');
              return {
                hasIframe: Boolean(iframe),
                iframeSrc: iframe ? iframe.src : null,
                hasUnableToLoad,
                hasTookLonger,
                hasRefreshBtn: Boolean(refreshBtn)
              };
            })()
          `,
          returnByValue: true
        }
      }));
    }, 1200);
  }

  if (msg.id === 4) {
    console.log('Preview mounted state:', msg.result);
    // Now click the refresh button!
    ws.send(JSON.stringify({
      id: 5,
      method: 'Runtime.evaluate',
      params: {
        expression: `
          (() => {
            const refreshBtn = document.querySelector('button[title*="Hard Reload"]') || document.querySelector('button[title*="Reload Viewport"]');
            if (refreshBtn) refreshBtn.click();
            return { clickedRefresh: Boolean(refreshBtn) };
          })()
        `,
        returnByValue: true
      }
    }));
  }

  if (msg.id === 5) {
    console.log('Clicked refresh:', msg.result);
    setTimeout(() => {
      ws.send(JSON.stringify({
        id: 6,
        method: 'Runtime.evaluate',
        params: {
          expression: `
            (() => {
              const iframe = document.querySelector('iframe');
              const text = document.body.innerText;
              const hasUnableToLoad = text.includes('Unable to load preview');
              const hasTookLonger = text.includes('Preview took longer than usual');
              const hasCrash = text.includes('Something went wrong') || text.includes('Unable to load preview');
              return {
                hasIframe: Boolean(iframe),
                iframeSrc: iframe ? iframe.src : null,
                hasUnableToLoad,
                hasTookLonger,
                hasCrash
              };
            })()
          `,
          returnByValue: true
        }
      }));
    }, 1500);
  }

  if (msg.id === 6) {
    console.log('After refresh state:', msg.result);
    process.exit(0);
  }

  if (msg.method === 'Runtime.exceptionThrown') {
    console.error('EXCEPTION THROWN IN PAGE:', JSON.stringify(msg.params.exceptionDetails));
  }
});
