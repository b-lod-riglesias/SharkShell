import { useState } from 'react';
import { useAuth } from '../context/AuthContext';

export default function SettingsPage() {
    const { user, changePassword } = useAuth();
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    async function handleSubmit(e) {
        e.preventDefault();
        setMessage('');
        setError('');

        if (newPassword !== confirmPassword) {
            setError('Las contraseñas nuevas no coinciden');
            return;
        }

        setSaving(true);
        try {
            await changePassword(currentPassword, newPassword);
            setMessage('Contraseña actualizada correctamente.');
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
        } catch (err) {
            setError(err.message || 'No se pudo actualizar la contraseña');
        } finally {
            setSaving(false);
        }
    }

    return (
        <div>
            <div className="page-header">
                <div>
                    <h1>Configuración</h1>
                    <p>Gestiona tu cuenta y contraseña</p>
                </div>
            </div>

            <div className="panel glass-card" style={{ maxWidth: 620, marginTop: 12 }}>
                <div className="panel-header">
                    <h2>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M12 15v-6m0 0V7a3 3 0 1 1 6 0v1m-3 3h.01M5 12a7 7 0 1 1 14 0 7 7 0 0 1-14 0z" />
                        </svg>
                        Cambiar contraseña
                    </h2>
                </div>
                <div className="panel-body">
                    <div style={{ marginBottom: 18 }}>
                        <span style={{ color: 'var(--text-secondary)', display: 'inline-block' }}>
                            Usuario: <strong>{user?.email}</strong>
                        </span>
                    </div>

                    <form onSubmit={handleSubmit}>
                        {error && <div className="auth-error">{error}</div>}
                        {message && <div className="toast toast-success">{message}</div>}

                        <div className="input-group" style={{ marginBottom: 14 }}>
                            <label>Contraseña actual</label>
                            <input
                                type="password"
                                className="input-field"
                                placeholder="••••••••"
                                value={currentPassword}
                                onChange={(e) => setCurrentPassword(e.target.value)}
                                required
                            />
                        </div>

                        <div className="input-group" style={{ marginBottom: 14 }}>
                            <label>Nueva contraseña</label>
                            <input
                                type="password"
                                className="input-field"
                                placeholder="Mínimo 8 caracteres"
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                required
                            />
                        </div>

                        <div className="input-group" style={{ marginBottom: 14 }}>
                            <label>Confirmar nueva contraseña</label>
                            <input
                                type="password"
                                className="input-field"
                                placeholder="Repite la nueva contraseña"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                required
                            />
                        </div>

                        <button className="btn btn-primary" disabled={saving} type="submit">
                            {saving ? 'Guardando...' : 'Actualizar contraseña'}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
}
