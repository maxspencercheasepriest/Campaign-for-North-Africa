const $ = (id) => document.getElementById(id);

async function loadSaves() {
  const saves = await window.desktop.listSaves();
  if (!saves.length) return;
  const box = $('saves');
  box.innerHTML = '<span class="label">Continue a saved campaign:</span>';
  for (const s of saves.slice(0, 6)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = s.name;
    b.title = 'Last played ' + new Date(s.modified).toLocaleString();
    b.onclick = () => { $('campaign').value = s.name; };
    box.appendChild(b);
  }
}

$('hostForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = $('hostStatus');
  const btn = e.submitter;
  btn.disabled = true;
  status.textContent = $('tunnel').checked ? 'Starting the game server and asking Cloudflare for a link…' : 'Starting the game server…';
  try {
    const info = await window.desktop.host({ campaign: $('campaign').value, useTunnel: $('tunnel').checked });
    if (info.tunnelError) {
      status.textContent = `Hosting locally, but no online link: ${info.tunnelError}`;
      await new Promise((r) => setTimeout(r, 2500));
    }
    await window.desktop.openHost(info);
  } catch (err) {
    status.textContent = 'Could not start: ' + err.message;
    btn.disabled = false;
  }
});

$('joinForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = await window.desktop.join($('joinUrl').value);
  if (err) $('joinStatus').textContent = err;
});

loadSaves();
