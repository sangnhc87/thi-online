import React, { useEffect, useState, useRef } from 'react';

// Lightweight canvas confetti for celebrations
export default function ConfettiEffect({ active = false, duration = 3000 }) {
    const canvasRef = useRef(null);
    const [running, setRunning] = useState(false);

    useEffect(() => {
        if (!active) return;
        setRunning(true);
        const timer = setTimeout(() => setRunning(false), duration);
        return () => clearTimeout(timer);
    }, [active, duration]);

    useEffect(() => {
        if (!running || !canvasRef.current) return;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;

        const colors = ['#5b5ea6', '#a855f7', '#f97316', '#10b981', '#3b82f6', '#ef4444', '#f59e0b', '#ec4899'];
        const particles = [];

        for (let i = 0; i < 120; i++) {
            particles.push({
                x: Math.random() * canvas.width,
                y: Math.random() * canvas.height - canvas.height,
                w: Math.random() * 8 + 4,
                h: Math.random() * 6 + 3,
                color: colors[Math.floor(Math.random() * colors.length)],
                vx: (Math.random() - 0.5) * 4,
                vy: Math.random() * 3 + 2,
                rotation: Math.random() * 360,
                rotationSpeed: (Math.random() - 0.5) * 10,
                opacity: 1,
            });
        }

        let animId;
        const animate = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            let alive = false;

            for (const p of particles) {
                p.x += p.vx;
                p.y += p.vy;
                p.vy += 0.05; // gravity
                p.rotation += p.rotationSpeed;
                p.opacity -= 0.003;

                if (p.opacity > 0 && p.y < canvas.height + 20) {
                    alive = true;
                    ctx.save();
                    ctx.translate(p.x, p.y);
                    ctx.rotate((p.rotation * Math.PI) / 180);
                    ctx.globalAlpha = Math.max(0, p.opacity);
                    ctx.fillStyle = p.color;
                    ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
                    ctx.restore();
                }
            }

            if (alive) {
                animId = requestAnimationFrame(animate);
            }
        };

        animate();
        return () => cancelAnimationFrame(animId);
    }, [running]);

    if (!running) return null;

    return (
        <canvas
            ref={canvasRef}
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                pointerEvents: 'none',
                zIndex: 10000,
            }}
        />
    );
}
