// Core UI Logic for MVP

document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const toggleSync = document.getElementById('toggle-sync');
    const syncDescription = document.getElementById('sync-description');
    const deviceList = document.getElementById('device-list');
    
    // Sharing UI
    const shareInactive = document.getElementById('share-inactive');
    const shareActive = document.getElementById('share-active');
    const btnStartShare = document.getElementById('btn-start-share');
    const btnStopShare = document.getElementById('btn-stop-share');
    const memberList = document.getElementById('member-list');

    // Mock Data (will be replaced by API calls to backend control plane)
    let isSyncing = true;
    let isSharing = false;
    let devices = [
        { id: '1', name: 'MacBook Pro', platform: 'macOS', active: true },
        { id: '2', name: 'iPhone 15', platform: 'iOS', active: true }
    ];
    let shareMembers = [];

    // Initialize UI
    function render() {
        // Sync Status
        toggleSync.checked = isSyncing;
        if (isSyncing) {
            syncDescription.textContent = 'Sync is ON. Your clipboard will be synced across your devices.';
            syncDescription.className = 'status-text active';
        } else {
            syncDescription.textContent = 'Sync is paused. Devices will not receive clipboard updates.';
            syncDescription.className = 'status-text inactive';
        }

        // Devices
        deviceList.innerHTML = '';
        devices.forEach(device => {
            const li = document.createElement('li');
            li.innerHTML = `
                <div>
                    <strong>${device.name}</strong> <span style="color: var(--text-muted); font-size: 0.8rem;">(${device.platform})</span>
                </div>
                <button class="btn danger" onclick="window.revokeDevice('${device.id}')">Revoke</button>
            `;
            deviceList.appendChild(li);
        });

        // Sharing
        if (isSharing) {
            shareInactive.classList.add('hidden');
            shareActive.classList.remove('hidden');
            memberList.innerHTML = '';
            shareMembers.forEach(member => {
                const li = document.createElement('li');
                li.innerHTML = `
                    <span>${member.name}</span>
                    <button class="btn danger" onclick="window.revokeMember('${member.id}')">Remove</button>
                `;
                memberList.appendChild(li);
            });
            if (shareMembers.length === 0) {
                memberList.innerHTML = '<li style="color: var(--text-muted)">Waiting for members to join...</li>';
            }
        } else {
            shareInactive.classList.remove('hidden');
            shareActive.classList.add('hidden');
        }
    }

    // Event Listeners
    toggleSync.addEventListener('change', (e) => {
        isSyncing = e.target.checked;
        render();
    });

    btnStartShare.addEventListener('click', () => {
        isSharing = true;
        // Mock session member joining after 2s
        setTimeout(() => {
            if (isSharing) {
                shareMembers.push({ id: 'a1', name: 'Alice (alice@example.com)' });
                render();
            }
        }, 2000);
        render();
    });

    btnStopShare.addEventListener('click', () => {
        if(confirm("Are you sure you want to stop sharing?")) {
            isSharing = false;
            shareMembers = [];
            render();
        }
    });

    // Global handlers for inline onclick
    window.revokeDevice = (id) => {
        if(confirm("Are you sure you want to revoke this device? It will stop syncing immediately.")) {
            devices = devices.filter(d => d.id !== id);
            render();
        }
    };

    window.revokeMember = (id) => {
        if(confirm("Remove this member from the session?")) {
            shareMembers = shareMembers.filter(m => m.id !== id);
            render();
        }
    };

    // Initial Render
    render();
});
