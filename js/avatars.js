// ============================================================
// AVATAR DATA
// Default avatars using emoji/SVG icons
// ============================================================
const AVATARS = [
  { id: 'avatar-1', emoji: '🦊', name: 'Fox', color: '#FF6B35' },
  { id: 'avatar-2', emoji: '🐱', name: 'Cat', color: '#FFB6C1' },
  { id: 'avatar-3', emoji: '🐶', name: 'Dog', color: '#8B4513' },
  { id: 'avatar-4', emoji: '🦁', name: 'Lion', color: '#DAA520' },
  { id: 'avatar-5', emoji: '🐼', name: 'Panda', color: '#000000' },
  { id: 'avatar-6', emoji: '🐧', name: 'Penguin', color: '#2F4F4F' },
  { id: 'avatar-7', emoji: '🦄', name: 'Unicorn', color: '#FF69B4' },
  { id: 'avatar-8', emoji: '🐉', name: 'Dragon', color: '#228B22' },
  { id: 'avatar-9', emoji: '🤖', name: 'Robot', color: '#708090' },
  { id: 'avatar-10', emoji: '👽', name: 'Alien', color: '#00FF00' },
  { id: 'avatar-11', emoji: '🎃', name: 'Pumpkin', color: '#FF8C00' },
  { id: 'avatar-12', emoji: '🔥', name: 'Fire', color: '#FF4500' },
  { id: 'avatar-13', emoji: '⚡', name: 'Lightning', color: '#FFD700' },
  { id: 'avatar-14', emoji: '🎯', name: 'Target', color: '#FF0000' },
  { id: 'avatar-15', emoji: '🚀', name: 'Rocket', color: '#4169E1' },
  { id: 'avatar-16', emoji: '🎮', name: 'Gamer', color: '#8A2BE2' },
  { id: 'avatar-17', emoji: '💀', name: 'Skull', color: '#FFFFFF' },
  { id: 'avatar-18', emoji: '🧙', name: 'Wizard', color: '#4B0082' },
  { id: 'avatar-19', emoji: '🥷', name: 'Ninja', color: '#1C1C1C' },
  { id: 'avatar-20', emoji: '🦸', name: 'Hero', color: '#0000FF' },
  { id: 'avatar-21', emoji: '🎸', name: 'Guitar', color: '#B22222' },
  { id: 'avatar-22', emoji: '🎭', name: 'Theater', color: '#9370DB' },
  { id: 'avatar-23', emoji: '💎', name: 'Diamond', color: '#00CED1' },
  { id: 'avatar-24', emoji: '🌟', name: 'Star', color: '#FFD700' },
];

// Render avatar grid into a container element
function renderAvatarGrid(containerId, selectedCallback) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = AVATARS.map(avatar => `
    <div class="avatar-option" data-avatar-id="${avatar.id}" onclick="${selectedCallback}('${avatar.id}')">
      <div class="avatar-circle" style="background: ${avatar.color}20; border-color: ${avatar.color}">
        <span class="avatar-emoji">${avatar.emoji}</span>
      </div>
      <span class="avatar-name">${avatar.name}</span>
    </div>
  `).join('');
}

// Get avatar by ID
function getAvatarById(id) {
  return AVATARS.find(a => a.id === id) || AVATARS[0];
}
