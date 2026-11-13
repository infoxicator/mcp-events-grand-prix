if(new URLSearchParams(location.search).has('track')) await import('./race/flythrough'); else await import('./pong-web');
export {};
