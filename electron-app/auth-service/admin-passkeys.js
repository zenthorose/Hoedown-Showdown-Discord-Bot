(() => {
  const status = document.querySelector('#status');
  const retry = document.querySelector('#retry');
  const fragment = new URLSearchParams(location.hash.slice(1));
  const context = {
    ticket: fragment.get('ticket') || '',
    redirectUri: fragment.get('redirectUri') || '',
    state: fragment.get('state') || '',
    deviceId: fragment.get('deviceId') || '',
    deviceName: fragment.get('deviceName') || '',
    platform: fragment.get('platform') || ''
  };
  const action = fragment.get('action') || '';
  history.replaceState(null, '', `${location.pathname}${location.search}`);

  const fromBase64Url = (value) => {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0)).buffer;
  };
  const toBase64Url = (buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  };
  const request = async (path, body) => {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      cache: 'no-store',
      credentials: 'same-origin',
      body: JSON.stringify(body)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Passkey request failed.');
    return result;
  };
  const showError = (error) => {
    status.textContent = error.message || 'Passkey authentication failed.';
    retry.hidden = false;
  };
  const redirectWithCode = (result) => {
    const callback = new URL(result.redirectUri);
    callback.searchParams.set('code', result.code);
    callback.searchParams.set('state', result.state);
    location.assign(callback.href);
  };
  const serializeCredential = (credential, registration) => ({
    id: credential.id,
    rawId: toBase64Url(credential.rawId),
    type: credential.type,
    response: registration ? {
      attestationObject: toBase64Url(credential.response.attestationObject),
      clientDataJSON: toBase64Url(credential.response.clientDataJSON),
      transports: credential.response.getTransports?.() || []
    } : {
      authenticatorData: toBase64Url(credential.response.authenticatorData),
      clientDataJSON: toBase64Url(credential.response.clientDataJSON),
      signature: toBase64Url(credential.response.signature),
      userHandle: credential.response.userHandle
        ? toBase64Url(credential.response.userHandle)
        : null
    }
  });
  const runRegistration = async (routePrefix) => {
    if (!context.ticket) throw new Error('The one-time registration ticket is missing.');
    status.textContent = 'Follow your authenticator prompt to register this passkey…';
    const registration = await request(
      `/api/admin/passkeys/${routePrefix}/options`, { ticket: context.ticket }
    );
    const { options, challengeId } = registration;
    options.challenge = fromBase64Url(options.challenge);
    options.user.id = fromBase64Url(options.user.id);
    for (const credential of options.excludeCredentials || []) {
      credential.id = fromBase64Url(credential.id);
    }
    const credential = await navigator.credentials.create({ publicKey: options });
    if (!credential) throw new Error('Passkey registration was cancelled.');
    const result = await request(`/api/admin/passkeys/${routePrefix}/verify`, {
      ticket: context.ticket,
      challengeId,
      response: serializeCredential(credential, true)
    });
    if (result.code) {
      redirectWithCode({
        code: result.code,
        redirectUri: registration.redirectUri,
        state: registration.state
      });
    }
    else status.textContent = 'Backup passkey registered. You can close this page.';
  };
  const runSignIn = async () => {
    if (!context.redirectUri || !context.state || !context.deviceId ||
        !context.deviceName || !context.platform) {
      throw new Error('Open this page from the Account Manager to sign in.');
    }
    status.textContent = 'Follow your authenticator prompt to sign in…';
    const { options, challengeId } = await request('/api/admin/passkeys/login/options', context);
    options.challenge = fromBase64Url(options.challenge);
    for (const credential of options.allowCredentials || []) {
      credential.id = fromBase64Url(credential.id);
    }
    const credential = await navigator.credentials.get({ publicKey: options });
    if (!credential) throw new Error('Passkey sign-in was cancelled.');
    const result = await request('/api/admin/passkeys/login/verify', {
      challengeId,
      response: serializeCredential(credential, false)
    });
    redirectWithCode({
      code: result.code,
      redirectUri: context.redirectUri,
      state: context.state
    });
  };
  const run = async () => {
    retry.hidden = true;
    try {
      if (!window.PublicKeyCredential || !navigator.credentials) {
        throw new Error('This browser does not support passkeys.');
      }
      if (action === 'enroll' && context.ticket) {
        await runRegistration('bootstrap');
      } else if (action === 'register' && context.ticket) {
        await runRegistration('credentials');
      } else if (action === 'login' && !context.ticket) {
        await runSignIn();
      } else {
        throw new Error('The passkey ceremony link is invalid or expired.');
      }
    } catch (error) {
      showError(error);
    }
  };
  retry.addEventListener('click', run);
  run();
})();
