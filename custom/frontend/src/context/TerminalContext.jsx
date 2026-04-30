import { createContext, useContext, useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { API_URL } from '../api';

const TerminalContext = createContext(null);

const STORAGE_KEY = 'sharkshell_workspaces';
let wsCounter = 0;
let sessionCounter = 0;
let paneCounter = 0;

function parseCounter(value, prefix) {
    const num = parseInt(String(value || '').replace(`${prefix}-`, ''), 10);
    return Number.isNaN(num) ? null : num;
}

function normalizeDirection(value) {
    return value === 'horizontal' ? 'horizontal' : 'vertical';
}

function getWorkspaceCounterSeed(id) {
    const num = parseCounter(id, 'ws');
    if (num !== null && num > wsCounter) wsCounter = num;
}

function getSessionCounterSeed(id) {
    const num = parseCounter(id, 'sess');
    if (num !== null && num > sessionCounter) sessionCounter = num;
}

function getPaneCounterSeed(id) {
    const num = parseCounter(id, 'pane');
    if (num !== null && num > paneCounter) paneCounter = num;
}

function normalizeWorkspace(rawWorkspace) {
    const workspace = {
        id: rawWorkspace.id,
        name: rawWorkspace.name || 'Workspace',
        sessions: Array.isArray(rawWorkspace.sessions) ? rawWorkspace.sessions : [],
        splitDirection: normalizeDirection(rawWorkspace.splitDirection),
    };

    const validSessions = workspace.sessions.map((session, index) => {
        getSessionCounterSeed(session.id);
        return {
            id: session.id || `sess-${++sessionCounter}`,
            hostId: session.hostId || null,
            hostName: session.hostName || `host-${index + 1}`,
            hostAddr: session.hostAddr || 'unknown',
            status: session.status || 'saved',
        };
    });

    const validSessionIds = new Set(validSessions.map((s) => s.id));
    let panes = Array.isArray(rawWorkspace.panes) ? rawWorkspace.panes : [];
    panes = panes.map((pane, idx) => {
        getPaneCounterSeed(pane.id);
        return {
            id: pane.id || `pane-${++paneCounter}`,
            sessionId:
                typeof pane.sessionId === 'string' && validSessionIds.has(pane.sessionId)
                    ? pane.sessionId
                    : null,
        };
    }).filter((pane) => !!pane.id);

    if (panes.length === 0) {
        panes = [{ id: `pane-${++paneCounter}`, sessionId: null }];
    }

    const usedSessionIds = new Set();
    panes = panes.map((pane) => {
        if (!pane.sessionId || usedSessionIds.has(pane.sessionId)) {
            return { ...pane, sessionId: null };
        }
        usedSessionIds.add(pane.sessionId);
        return pane;
    });

    if (validSessions.length > 0 && !panes.some((p) => !!p.sessionId)) {
        panes[0].sessionId = validSessions[0].id;
    }

    let activePaneId = rawWorkspace.activePaneId;
    if (!activePaneId || !panes.some((p) => p.id === activePaneId)) {
        activePaneId = panes[0].id;
    }

    return {
        ...workspace,
        sessions: validSessions,
        panes,
        activePaneId,
    };
}

function loadSavedWorkspaces() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed)) {
                parsed.forEach((workspace) => {
                    getWorkspaceCounterSeed(workspace.id);
                    getPaneCounterSeed(workspace.activePaneId);
                    workspace?.sessions?.forEach((session) => getSessionCounterSeed(session.id));
                    workspace?.panes?.forEach((pane) => getPaneCounterSeed(pane.id));
                });
                const data = parsed.map((ws) => normalizeWorkspace(ws));
                if (!data.find((ws) => ws.id === 'ws-default')) {
                    data.unshift(normalizeWorkspace({
                        id: 'ws-default',
                        name: 'Default',
                        sessions: [],
                        splitDirection: 'vertical',
                        panes: [{ id: `pane-${++paneCounter}`, sessionId: null }],
                        activePaneId: `pane-${paneCounter}`,
                    }));
                }
                return data;
            }
        }
    } catch { }
    return [{
        id: 'ws-default',
        name: 'Default',
        splitDirection: 'vertical',
        sessions: [],
        panes: [{ id: `pane-${++paneCounter}`, sessionId: null }],
        activePaneId: `pane-${paneCounter}`,
    }];
}

function saveWorkspacesToStorage(workspaces) {
    try {
        const toSave = workspaces.map((ws) => ({
            id: ws.id,
            name: ws.name,
            splitDirection: ws.splitDirection || 'vertical',
            sessions: ws.sessions.map((s) => ({
                id: s.id,
                hostId: s.hostId,
                hostName: s.hostName,
                hostAddr: s.hostAddr,
                status: s.status,
            })),
            panes: (ws.panes || []).map((pane) => ({
                id: pane.id,
                sessionId: pane.sessionId || null,
            })),
            activePaneId: ws.activePaneId || null,
        }));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    } catch { }
}

function removeSessionFromPanes(panes, sessionId) {
    return panes.map((pane) => pane.sessionId === sessionId ? { ...pane, sessionId: null } : pane);
}

export function TerminalProvider({ children }) {
    const { token } = useAuth();
    const navigate = useNavigate();

    const [workspaces, setWorkspaces] = useState(() => loadSavedWorkspaces());
    const [activeWorkspaceId, setActiveWorkspaceId] = useState('ws-default');
    const [activeSessionId, setActiveSessionId] = useState(null);
    const [passphrasePrompt, setPassphrasePrompt] = useState(null); // { sessionId, hostId }

    // Refs to hold live socket/term objects (not in React state to avoid re-renders)
    const sessionRefs = useRef({}); // { [sessionId]: { socket, term, fitAddon, resizeObserver } }

    // ─── Auto-save workspaces on change ───
    useEffect(() => {
        saveWorkspacesToStorage(workspaces);
    }, [workspaces]);

    function sanitizeWorkspace(workspaceId) {
        return normalizeWorkspace(workspaces.find((ws) => ws.id === workspaceId) || {});
    }

    function updateWorkspace(workspaceId, updater) {
        setWorkspaces((prev) => prev.map((ws) => {
            if (ws.id !== workspaceId) return ws;
            const normalized = normalizeWorkspace(ws);
            return updater(normalized);
        }));
    }

    function setActiveWorkspace(workspaceId) {
        const exists = workspaces.some((ws) => ws.id === workspaceId);
        if (exists) setActiveWorkspaceId(workspaceId);
    }

    function getActiveWorkspace() {
        return workspaces.find((w) => w.id === activeWorkspaceId) || null;
    }

    function getActivePaneId(workspace) {
        if (!workspace || !Array.isArray(workspace.panes) || workspace.panes.length === 0) {
            return null;
        }
        return workspace.panes.some((p) => p.id === workspace.activePaneId)
            ? workspace.activePaneId
            : workspace.panes[0].id;
    }

    function getWorkspaceAndSession(sessionId) {
        for (const ws of workspaces) {
            const session = ws.sessions.find((s) => s.id === sessionId);
            if (session) return { workspace: ws, session };
        }
        return null;
    }

    function assignSessionToPane(workspace, sessionId, { allowCreatePane = false } = {}) {
        const base = normalizeWorkspace(workspace);
        const panes = removeSessionFromPanes(base.panes || [], sessionId);
        const activePaneId = getActivePaneId(base);
        const activePane = panes.find((p) => p.id === activePaneId) || panes[0];

        let targetIndex = -1;

        if (activePane && activePane.sessionId == null) {
            targetIndex = panes.findIndex((p) => p.id === activePane.id);
        } else {
            targetIndex = panes.findIndex((p) => p.sessionId == null);
        }

        if (targetIndex === -1 && allowCreatePane) {
            const insertAt = Math.max(0, panes.findIndex((p) => p.id === activePane?.id) + 1);
            const newPane = { id: `pane-${++paneCounter}`, sessionId };
            const nextPanes = [
                ...panes.slice(0, insertAt),
                newPane,
                ...panes.slice(insertAt),
            ];
            return { ...base, panes: nextPanes, activePaneId: newPane.id };
        }

        if (targetIndex === -1) {
            targetIndex = panes.findIndex((p) => p.id === activePane?.id);
        }
        if (targetIndex === -1) {
            targetIndex = 0;
        }

        panes[targetIndex] = { ...panes[targetIndex], sessionId };
        return { ...base, panes, activePaneId: panes[targetIndex].id };
    }

    // ─── Workspace CRUD ───

    function createWorkspace(name) {
        const id = `ws-${++wsCounter}`;
        const workspace = normalizeWorkspace({
            id,
            name: name || `Workspace ${wsCounter}`,
            sessions: [],
            splitDirection: 'vertical',
            panes: [{ id: `pane-${++paneCounter}`, sessionId: null }],
            activePaneId: `pane-${paneCounter}`,
        });
        setWorkspaces((prev) => [...prev, workspace]);
        setActiveWorkspaceId(id);
        navigate('/dashboard/terminal');
        return id;
    }

    function renameWorkspace(id, name) {
        setWorkspaces((prev) => prev.map((w) => w.id === id ? { ...w, name } : w));
    }

    function deleteWorkspace(id) {
        if (id === 'ws-default') return;
        const ws = workspaces.find((w) => w.id === id);
        if (ws) {
            ws.sessions.forEach((s) => destroySessionRefs(s.id));
        }
        setWorkspaces((prev) => {
            const remaining = prev.filter((w) => w.id !== id);
            if (activeWorkspaceId === id) {
                setActiveWorkspaceId('ws-default');
                setActiveSessionId(null);
            }
            return remaining;
        });
    }

    // ─── Session Management ───

    function createSession(workspaceId, host) {
        const wId = workspaceId || activeWorkspaceId;
        const id = `sess-${++sessionCounter}`;
        const session = {
            id,
            hostId: host.id,
            hostName: host.name,
            hostAddr: `${host.username}@${host.hostname}`,
            status: 'connecting',
        };
        updateWorkspace(wId, (ws) => {
            const withSession = {
                ...ws,
                sessions: [...ws.sessions, session],
            };
            return assignSessionToPane(withSession, id, { allowCreatePane: true });
        });
        setActiveWorkspaceId(wId);
        setActiveSessionId(id);
        const activeWorkspace = sanitizeWorkspace(wId);
        setActiveWorkspaceId(wId);
        setActiveSessionId(id);
        const activePaneId = getActivePaneId(activeWorkspace);
        if (activePaneId) {
            setWorkspaces((prev) => prev.map((ws) => ws.id === wId
                ? { ...normalizeWorkspace(ws), activePaneId }
                : ws));
        }
        setTimeout(() => connectSession(id, host, wId), 80);
        return id;
    }

    function reconnectSession(sessionId) {
        const found = getWorkspaceAndSession(sessionId);
        if (!found) return;

        const { workspace, session } = found;
        updateWorkspace(workspace.id, (ws) => {
            if (ws.panes.some((p) => p.sessionId === sessionId)) {
                return {
                    ...ws,
                    activePaneId: ws.panes.find((p) => p.sessionId === sessionId).id,
                };
            }
            return assignSessionToPane(ws, sessionId);
        });

        updateSessionStatus(sessionId, 'connecting');
        setActiveWorkspaceId(workspace.id);
        setActiveSessionId(sessionId);
        navigate('/dashboard/terminal');

        // Use a minimal host object for connection
        const host = { id: session.hostId, name: session.hostName, hostname: session.hostAddr.split('@')[1], username: session.hostAddr.split('@')[0] };
        setTimeout(() => connectSession(sessionId, host, workspace.id), 80);
    }

    function reconnectWorkspace(workspaceId) {
        const ws = workspaces.find((w) => w.id === workspaceId);
        if (!ws) return;
        const toReconnect = ws.sessions.filter((s) => s.status === 'saved' || s.status === 'disconnected');
        toReconnect.forEach((s, i) => {
            setTimeout(() => reconnectSession(s.id), i * 150);
        });
    }

    function connectSession(sessionId, host, workspaceId = activeWorkspaceId) {
        const wsId = workspaceId || activeWorkspaceId;
        const workspace = workspaces.find((w) => w.id === wsId);
        const activePaneId = workspace ? getActivePaneId(workspace) : null;

        const loadSession = async () => {
            const { Terminal } = await import('@xterm/xterm');
            const { FitAddon } = await import('@xterm/addon-fit');
            const { WebLinksAddon } = await import('@xterm/addon-web-links');

            // If there's already a term, dispose it first
            if (sessionRefs.current[sessionId]?.term) {
                sessionRefs.current[sessionId].term.dispose();
            }

            const term = new Terminal({
                theme: {
                    background: '#0d1117',
                    foreground: '#c9d1d9',
                    cursor: '#58a6ff',
                    cursorAccent: '#0d1117',
                    selectionBackground: 'rgba(99, 102, 241, 0.3)',
                },
                fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
                fontSize: 14,
                cursorBlink: true,
                cursorStyle: 'bar',
                scrollback: 5000,
            });

            const fitAddon = new FitAddon();
            term.loadAddon(fitAddon);
            term.loadAddon(new WebLinksAddon());

            const paneSessionId = `term-${sessionId}`;
            const container = document.getElementById(paneSessionId);
            if (container) {
                container.innerHTML = '';
                term.open(container);
                try {
                    fitAddon.fit();
                } catch { }
            }

            term.writeln(`\x1b[33m⏳ Connecting to ${host.name}...\x1b[0m`);

            const resizeObserver = new ResizeObserver(() => {
                try {
                    fitAddon.fit();
                } catch { }
            });
            if (container) {
                resizeObserver.observe(container);
            }

            sessionRefs.current[sessionId] = { socket: null, term, fitAddon, resizeObserver };

            try {
                const { io } = await import('socket.io-client');
                const socketUrl = API_URL || window.location.origin;
                const socket = io(socketUrl, { path: '/api/socket', auth: { token }, transports: ['websocket', 'polling'] });

                sessionRefs.current[sessionId].socket = socket;

                term.onData((data) => { if (socket.connected) socket.emit('ssh:input', data); });
                term.onResize(({ cols, rows }) => { if (socket.connected) socket.emit('ssh:resize', { cols, rows }); });

                socket.on('connect', () => {
                    const pane = (workspace && getActivePaneId(workspace) === activePaneId) ? { hostId: host.id } : { hostId: host.id };
                    socket.emit('ssh:connect', { hostId: pane.hostId || host.id, cols: term.cols, rows: term.rows });
                });

                socket.on('ssh:connected', () => {
                    updateSessionStatus(sessionId, 'connected');
                    term.clear();
                    term.focus();
                });

                socket.on('ssh:data', (data) => { term.write(data); });

                socket.on('ssh:passphrase-needed', (data) => {
                    term.writeln(`\r\n\x1b[33m🔑 Passphrase required for this key\x1b[0m\r\n`);
                    setPassphrasePrompt({ sessionId, hostId: data.hostId });
                });

                socket.on('ssh:error', (data) => {
                    term.writeln(`\r\n\x1b[31m❌ Error: ${data.message}\x1b[0m\r\n`);
                    updateSessionStatus(sessionId, 'disconnected');
                });

                socket.on('ssh:closed', (data) => {
                    term.writeln(`\r\n\x1b[33m⚡ ${data.message || 'Connection closed'}\x1b[0m\r\n`);
                    updateSessionStatus(sessionId, 'disconnected');
                });

                socket.on('connect_error', (err) => {
                    term.writeln(`\r\n\x1b[31m❌ Socket error: ${err.message}\x1b[0m\r\n`);
                    updateSessionStatus(sessionId, 'disconnected');
                });
            } catch (err) {
                term.writeln(`\r\n\x1b[31m❌ Failed: ${err.message}\x1b[0m\r\n`);
                updateSessionStatus(sessionId, 'disconnected');
            }
        };

        loadSession();
    }

    function updateSessionStatus(sessionId, status) {
        setWorkspaces((prev) => prev.map((w) => ({
            ...w,
            sessions: w.sessions.map((s) => (s.id === sessionId ? { ...s, status } : s)),
        })));
    }

    function closeSession(sessionId) {
        const foundWorkspace = getWorkspaceAndSession(sessionId);
        if (!foundWorkspace) {
            return;
        }

        const nextSessionId = foundWorkspace.workspace.sessions
            .map((s) => s.id)
            .filter((id) => id !== sessionId)
            .slice(-1)[0] || null;

        destroySessionRefs(sessionId);
        setWorkspaces((prev) => prev.map((w) => {
            if (w.id !== foundWorkspace.workspace.id) return w;
            const normalized = normalizeWorkspace(w);
            const sessions = normalized.sessions.filter((s) => s.id !== sessionId);
            const panes = sessions.length === 0
                ? normalized.panes.map((p) => ({ ...p, sessionId: null }))
                : removeSessionFromPanes(normalized.panes, sessionId);
            return {
                ...normalized,
                sessions,
                panes,
            };
        }));

        if (activeSessionId === sessionId) {
            setActiveSessionId(nextSessionId);
        }
    }

    function destroySessionRefs(sessionId) {
        const refs = sessionRefs.current[sessionId];
        if (refs) {
            if (refs.socket) {
                refs.socket.emit('ssh:disconnect');
                refs.socket.disconnect();
            }
            if (refs.resizeObserver) {
                refs.resizeObserver.disconnect();
            }
            if (refs.term) {
                refs.term.dispose();
            }
            delete sessionRefs.current[sessionId];
        }
    }

    function switchSession(workspaceId, sessionId) {
        const workspace = workspaces.find((w) => w.id === workspaceId);
        if (!workspace) return;

        const hasSession = workspace.sessions.some((s) => s.id === sessionId);
        if (!hasSession) return;

        setActiveWorkspaceId(workspaceId);
        setActiveSessionId(sessionId);

        updateWorkspace(workspaceId, (ws) => {
            const existing = ws.panes.find((p) => p.sessionId === sessionId);
            if (existing) {
                return { ...ws, activePaneId: existing.id };
            }
            return assignSessionToPane(ws, sessionId);
        });

        setTimeout(() => {
            const refs = getSessionRefs(sessionId);
            if (refs?.fitAddon) {
                try {
                    refs.fitAddon.fit();
                } catch { }
            }
            if (refs?.term) {
                refs.term.focus();
            }
        }, 30);
    }

    function setActivePane(paneId) {
        setWorkspaces((prev) => prev.map((ws) => {
            if (ws.id !== activeWorkspaceId) return ws;
            const normalized = normalizeWorkspace(ws);
            if (!normalized.panes.some((p) => p.id === paneId)) return normalized;
            return { ...normalized, activePaneId: paneId };
        }));
    }

    function splitTerminal(direction) {
        const splitDirection = normalizeDirection(direction);
        const workspace = getActiveWorkspace();
        if (!workspace) return;

        updateWorkspace(workspace.id, (ws) => {
            const normalized = normalizeWorkspace(ws);
            const activePane = normalized.panes.find((p) => p.id === normalized.activePaneId) || normalized.panes[0];
            const insertAt = Math.max(0, normalized.panes.findIndex((p) => p.id === activePane?.id) + 1);
            const newPane = { id: `pane-${++paneCounter}`, sessionId: null };
            const panes = [
                ...normalized.panes.slice(0, insertAt),
                newPane,
                ...normalized.panes.slice(insertAt),
            ];
            return {
                ...normalized,
                splitDirection,
                panes,
                activePaneId: newPane.id,
            };
        });
    }

    function submitPassphrase(passphrase) {
        if (!passphrasePrompt) return;
        const { sessionId, hostId } = passphrasePrompt;
        const refs = sessionRefs.current[sessionId];
        if (refs?.socket?.connected) {
            refs.term?.writeln(`\x1b[33m⏳ Retrying with passphrase...\x1b[0m`);
            refs.socket.emit('ssh:connect', { hostId, passphrase, cols: refs.term?.cols || 80, rows: refs.term?.rows || 24 });
        }
        setPassphrasePrompt(null);
    }

    function cancelPassphrase() {
        if (passphrasePrompt) {
            const refs = sessionRefs.current[passphrasePrompt.sessionId];
            refs?.term?.writeln(`\r\n\x1b[31m❌ Passphrase not provided — connection cancelled\x1b[0m\r\n`);
            updateSessionStatus(passphrasePrompt.sessionId, 'disconnected');
        }
        setPassphrasePrompt(null);
    }

    function connectGroup(workspaceId, hostsInGroup) {
        const wId = workspaceId || activeWorkspaceId;
        hostsInGroup.forEach((host, i) => {
            setTimeout(() => createSession(wId, host), i * 150);
        });
    }

    function getSessionRefs(sessionId) {
        return sessionRefs.current[sessionId] || null;
    }

    const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId);
    const activePaneId = activeWorkspace?.activePaneId || null;

    return (
        <TerminalContext.Provider value={{
            workspaces,
            activeWorkspaceId,
            activeSessionId,
            activeWorkspace,
            activePaneId,
            createWorkspace,
            renameWorkspace,
            deleteWorkspace,
            createSession,
            closeSession,
            switchSession,
            connectGroup,
            getSessionRefs,
            reconnectSession,
            reconnectWorkspace,
            passphrasePrompt,
            submitPassphrase,
            cancelPassphrase,
            splitTerminal,
            setActivePane,
            setActiveWorkspaceId: setActiveWorkspace,
        }}>
            {children}
        </TerminalContext.Provider>
    );
}

export function useTerminal() {
    const ctx = useContext(TerminalContext);
    if (!ctx) throw new Error('useTerminal must be used within TerminalProvider');
    return ctx;
}
