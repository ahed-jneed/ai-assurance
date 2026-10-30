"use client";
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Download, ShieldCheck } from 'lucide-react';
import { DossierControls } from './dossier-controls';
export function PackageIntegrity({ tenantId, engagementId, reportId,onRefresh }: {
    tenantId: string;
    engagementId: string;
    reportId: string;
    onRefresh?:()=>Promise<unknown>;
}) {
    const [result, setResult] = useState<{
        valid: boolean;
        count: number;
    } | null>(null), [error, setError] = useState(''), [checking, setChecking] = useState(false), query = new URLSearchParams({ tenantId, engagementId, reportId });
    async function check() { setChecking(true); setError(''); try {
        const response = await fetch('/api/report-package?' + query, { cache: 'no-store' }), v = await response.json() as {
            valid: boolean;
            items: unknown[];
            error?: string;
        };
        if (!response.ok)
            throw Error(v.error);
        setResult({ valid: v.valid, count: v.items.length });
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'Could not verify package');
    }
    finally {
        setChecking(false);
    } }
    return <><details className="package-integrity-tools"><summary>Integrity & downloads</summary><section className="release-controls"><h3>Snapshot verification</h3><div className="row-actions"><Button variant="outline" disabled={checking} onClick={() => void check()}><ShieldCheck size={15}/>{checking ? 'Checking…' : 'Verify captured content'}</Button><a className="download-link" href={'/api/report-package?' + query + '&download=1'}><Download size={14}/>Download captured snapshot</a></div></section><DossierControls tenantId={tenantId} engagementId={engagementId} reportId={reportId} onRefresh={onRefresh}/></details>{result && <p className={result.valid ? 'subtle' : 'form-error'} role="status">{result.valid ? 'Captured content matches its recorded SHA-256 digest.' : 'Package integrity check failed.'} {result.count} captured manifest references.</p>}{error && <p className="form-error" role="alert">{error}</p>}</>;
}
