import * as vscode from 'vscode';
import * as http from 'http';
import * as https from 'https';

const CLIENT_ID = '1337677280-5ddo2g0i26029q2l17f3vlr3k9fpao3k.apps.googleusercontent.com';
const CLIENT_SECRET = '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';
const FIREBASE_API_KEY = 'AIzaSyAyEjk50E4vYqm1D0_SqyPe-iwVbJCRi4o';
const PORT = 3456;
const REDIRECT_URI = `http://127.0.0.1:${PORT}/callback`;

class FirebaseAuthenticationProvider implements vscode.AuthenticationProvider, vscode.Disposable {
    public readonly id = 'firebase';
    public readonly label = 'Firebase User';
    public readonly supportsMultipleAccounts = false;

    private _onDidChangeSessions = new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();
    get onDidChangeSessions() { return this._onDidChangeSessions.event; }

    private sessions: vscode.AuthenticationSession[] = [];
    private disposable: vscode.Disposable;

    constructor() {
        this.disposable = vscode.authentication.registerAuthenticationProvider('firebase', this.label, this, { supportsMultipleAccounts: false });
    }

    async getSessions(scopes?: string[]): Promise<vscode.AuthenticationSession[]> {
        return this.sessions;
    }

    async createSession(scopes: string[]): Promise<vscode.AuthenticationSession> {
        return new Promise((resolve, reject) => {
            const server = http.createServer(async (req, res) => {
                const url = new URL(req.url || '', `http://${req.headers.host}`);
                if (url.pathname === '/callback') {
                    const code = url.searchParams.get('code');
                    if (code) {
                        res.writeHead(200, { 'Content-Type': 'text/html' });
                        res.end('<h1>Success! You may close this tab and return to Black IDE.</h1><script>window.close()</script>');
                        server.close();
                        
                        try {
                            // 1. Exchange code for Google ID token
                            const tokenRes = await this.exchangeCode(code);
                            if (!tokenRes.id_token) {
                                throw new Error('Failed to get id_token from Google. Response: ' + JSON.stringify(tokenRes));
                            }
                            const idToken = tokenRes.id_token;
                            
                            // 2. Exchange Google ID token for Firebase token
                            const firebaseRes = await this.exchangeForFirebase(idToken);
                            if (!firebaseRes.idToken) {
                                throw new Error('Failed to get Firebase token. Response: ' + JSON.stringify(firebaseRes));
                            }
                            
                            const session: vscode.AuthenticationSession = {
                                id: firebaseRes.localId,
                                accessToken: firebaseRes.idToken,
                                account: {
                                    id: firebaseRes.email || firebaseRes.localId,
                                    label: firebaseRes.email || 'Firebase User'
                                },
                                scopes: scopes || []
                            };
                            
                            this.sessions.push(session);
                            this._onDidChangeSessions.fire({ added: [session], removed: [], changed: [] });
                            resolve(session);
                        } catch (err: any) {
                            vscode.window.showErrorMessage('Firebase Login Failed: ' + err.message);
                            reject(err);
                        }
                    } else {
                        res.writeHead(400, { 'Content-Type': 'text/plain' });
                        res.end('Missing code parameter');
                        server.close();
                        reject(new Error('Missing code'));
                    }
                }
            });

            server.listen(PORT, '127.0.0.1', () => {
                const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=openid%20email%20profile`;
                vscode.env.openExternal(vscode.Uri.parse(authUrl));
            });
            
            server.on('error', (err) => {
                vscode.window.showErrorMessage('Could not start local server on port 3456: ' + err.message);
                reject(err);
            });
        });
    }

    async removeSession(sessionId: string): Promise<void> {
        const sessionIndex = this.sessions.findIndex(s => s.id === sessionId);
        if (sessionIndex > -1) {
            const session = this.sessions[sessionIndex];
            this.sessions.splice(sessionIndex, 1);
            this._onDidChangeSessions.fire({ added: [], removed: [session], changed: [] });
        }
    }

    dispose() {
        this.disposable.dispose();
    }

    private exchangeCode(code: string): Promise<any> {
        return new Promise((resolve, reject) => {
            const data = new URLSearchParams({
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                code: code,
                grant_type: 'authorization_code',
                redirect_uri: REDIRECT_URI
            }).toString();

            const req = https.request('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Content-Length': Buffer.byteLength(data)
                }
            }, (res) => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => resolve(JSON.parse(body)));
            });
            req.on('error', reject);
            req.write(data);
            req.end();
        });
    }

    private exchangeForFirebase(idToken: string): Promise<any> {
        return new Promise((resolve, reject) => {
            const data = JSON.stringify({
                postBody: `id_token=${idToken}&providerId=google.com`,
                requestUri: REDIRECT_URI,
                returnIdpCredential: true,
                returnSecureToken: true
            });

            const req = https.request(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${FIREBASE_API_KEY}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(data)
                }
            }, (res) => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => resolve(JSON.parse(body)));
            });
            req.on('error', reject);
            req.write(data);
            req.end();
        });
    }
}

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(new FirebaseAuthenticationProvider());
}
