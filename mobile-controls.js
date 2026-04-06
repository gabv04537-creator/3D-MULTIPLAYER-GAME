// mobile-controls.js
export class MobileControls {
    constructor() {
        this.moveVector = { x: 0, z: 0 };
        this.isJumpPressed = false;
        this.active = ('ontouchstart' in window);

        if (this.active) {
            this.setupJoystick();
        }
    }

    setupJoystick() {
        // Create Joystick Outer Circle
        const base = document.createElement('div');
        Object.assign(base.style, {
            position: 'fixed', bottom: '50px', left: '50px',
            width: '120px', height: '120px',
            background: 'rgba(255, 255, 255, 0.1)',
            borderRadius: '50%', border: '2px solid rgba(255, 215, 0, 0.5)',
            zIndex: '4000', touchAction: 'none'
        });

        // Create Joystick Handle (Stick)
        const stick = document.createElement('div');
        Object.assign(stick.style, {
            position: 'absolute', top: '35px', left: '35px',
            width: '50px', height: '50px', background: 'gold',
            borderRadius: '50%', boxShadow: '0 0 10px rgba(0,0,0,0.5)'
        });

        base.appendChild(stick);
        document.body.appendChild(base);

        const handleMove = (e) => {
            const touch = e.touches[0];
            const rect = base.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            
            let dx = touch.clientX - centerX;
            let dy = touch.clientY - centerY;
            const distance = Math.min(Math.sqrt(dx*dx + dy*dy), 50);
            const angle = Math.atan2(dy, dx);

            const tx = Math.cos(angle) * distance;
            const ty = Math.sin(angle) * distance;

            stick.style.transform = `translate(${tx}px, ${ty}px)`;
            
            // Normalize for movement (0 to 1)
            this.moveVector.x = tx / 50;
            this.moveVector.z = ty / 50;
        };

        base.addEventListener('touchstart', handleMove);
        base.addEventListener('touchmove', (e) => { e.preventDefault(); handleMove(e); });
        base.addEventListener('touchend', () => {
            stick.style.transform = `translate(0, 0)`;
            this.moveVector.x = 0;
            this.moveVector.z = 0;
        });
    }
}