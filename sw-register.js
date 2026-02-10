// sw-register.js - Register service worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // Registration
    navigator.serviceWorker.register('/sw.js')
      .then((registration) => {
        console.log('Service Worker registered: ', registration);
      })
      .catch((error) => {
        console.error('Service Worker registration failed: ', error);
      });
  });
}