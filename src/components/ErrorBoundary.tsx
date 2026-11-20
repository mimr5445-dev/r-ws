import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Last-resort guard: if a render error escapes React, show a readable Arabic
 * screen instead of a blank canvas. The app keeps all user data in IndexedDB,
 * so a reload is safe and does not lose scenarios or maps.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[RW Studio] واجهة غير متوقعة:', error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        dir="rtl"
        role="alert"
        className="min-h-screen w-screen flex items-center justify-center bg-[#090f1a] text-slate-100 p-6"
      >
        <div className="w-full max-w-lg rounded-xl border border-red-500/60 bg-red-950/40 p-6 space-y-4 shadow-2xl">
          <h1 className="text-lg font-bold text-red-200">حدث خطأ غير متوقع في الاستوديو</h1>
          <p className="text-sm leading-6 text-red-100/90">
            أعمالك محفوظة محليًا في قاعدة بيانات المتصفح (IndexedDB). أعد تحميل الصفحة للمتابعة،
            وإذا تكرر الخطأ فافتح وحدة تحكم المتصفح وأرسل التفاصيل أدناه.
          </p>
          <pre
            dir="ltr"
            className="max-h-40 overflow-auto rounded-lg border border-red-900 bg-slate-950/80 p-3 text-left font-mono text-[11px] leading-5 text-red-300"
          >
            {error.message}
          </pre>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="flex-1 rounded-md border border-red-400 bg-red-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-500"
            >
              إعادة تحميل الاستوديو
            </button>
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-700"
            >
              المحاولة مجددًا
            </button>
          </div>
        </div>
      </div>
    );
  }
}
