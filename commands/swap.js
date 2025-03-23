const fetch = require('node-fetch');

async function swapPlayer(teamName, oldPlayer, newPlayer) {
    const url = 'https://script.google.com/macros/s/AKfycbzA23TVLxEhPBVNiL6Fk7R7jjQ1fo5TKKcOX2jnn9AWqFDPxTUzRT_4AAiwV4JN-DJE/dev'; // Replace with your Google Apps Script URL

    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: "swap", teamName, oldPlayer, newPlayer })
    });

    const text = await response.text();
    return text; // Send this message back to Discord
}
