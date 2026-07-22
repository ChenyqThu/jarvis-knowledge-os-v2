import { useState, type FormEvent } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { validateToken } from '../api';

interface TokenGateProps {
  onAuthenticated: (token: string) => void;
}

/** First-visit / post-401 screen: a minimal token input. Validates against
 * /api/v1/overview before handing control back to App so a bad token never
 * gets stored. */
export function TokenGate({ onAuthenticated }: TokenGateProps) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || checking) return;
    setChecking(true);
    setError(null);
    const ok = await validateToken(trimmed);
    setChecking(false);
    if (!ok) {
      setError('Token 无效或已过期');
      return;
    }
    onAuthenticated(trimmed);
  };

  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>KOS 知识库看板</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-3" onSubmit={submit}>
            <label htmlFor="token-input" className="text-sm text-muted-foreground">
              访问 Token
            </label>
            <Input
              id="token-input"
              className="mono"
              type="password"
              autoFocus
              autoComplete="off"
              value={value}
              onChange={e => setValue(e.target.value)}
              placeholder="粘贴 KOS_DASHBOARD_TOKEN"
              aria-invalid={error ? true : undefined}
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={checking || !value.trim()}>
              {checking ? '校验中…' : '进入'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
