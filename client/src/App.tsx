import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, useLocation } from "wouter";
import { useEffect, lazy, Suspense } from "react";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { Loader2 } from "lucide-react";

// Lightweight pages - static import
import Home from "./pages/Home";
import Login from "./pages/Login";
import Register from "./pages/Register";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import Terms from "./pages/Terms";
import Privacy from "./pages/Privacy";

// Heavy pages - lazy import
const AnalysisDetail = lazy(() => import("./pages/AnalysisDetailOriginal"));
const ReportView = lazy(() => import("./pages/ReportView"));
const Admin = lazy(() => import("./pages/Admin"));
const AdminLogs = lazy(() => import("./pages/AdminLogs").then(m => ({ default: m.AdminLogs })));
const Comparison = lazy(() => import("./pages/Comparison"));
const Trend = lazy(() => import("./pages/Trend"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const TrendDiscovery = lazy(() => import("./pages/TrendDiscovery"));
const TrendDiscoveryDetail = lazy(() => import("./pages/TrendDiscoveryDetailOriginal"));
const CampaignList = lazy(() => import("./pages/CampaignList"));
const CampaignNew = lazy(() => import("./pages/CampaignNew"));
const CampaignDetail = lazy(() => import("./pages/CampaignDetail"));
const CampaignReport = lazy(() => import("./pages/CampaignReportOriginal"));
const SharedReport = lazy(() => import("./pages/SharedReport"));
const AnalysisNew = lazy(() => import("./pages/AnalysisNew"));
const Activity = lazy(() => import("./pages/Activity"));
const Pricing = lazy(() => import("./pages/Pricing"));
const ContextAnalysis = lazy(() => import("./pages/ContextAnalysis"));
const PainAnalysis = lazy(() => import("./pages/PainAnalysis"));
const PrWordDevelopment = lazy(() => import("./pages/PrWordDevelopment"));
const ProductAnalysis = lazy(() => import("./pages/ProductAnalysis"));

function RedirectTo({ to }: { to: string }) {
  const [, navigate] = useLocation();
  useEffect(() => { navigate(to, { replace: true }); }, [to, navigate]);
  return null;
}

function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}

function ScrollToTop() {
  const [location] = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location]);
  return null;
}

function AnimatedPage({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  return (
    <div key={location} className="animate-page-enter">
      {children}
    </div>
  );
}

function Router() {
  return (
    <>
    <ScrollToTop />
    <Suspense fallback={<PageLoader />}>
    <AnimatedPage>
    <Switch>
      {/* Public routes */}
      <Route path="/login" component={Login} />
      <Route path="/register" component={Register} />
      <Route path="/forgot-password" component={ForgotPassword} />
      <Route path="/reset-password" component={ResetPassword} />
      <Route path="/terms" component={Terms} />
      <Route path="/privacy" component={Privacy} />
      <Route path="/share/:token" component={SharedReport} />
      {/* Protected routes */}
      <Route path={"/"} component={Home} />
      <Route path="/activity" component={Activity} />
      <Route path="/analysis/new" component={AnalysisNew} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/analysis/:id" component={AnalysisDetail} />
      <Route path="/compare" component={Comparison} />
      <Route path="/trend" component={Trend} />
      <Route path="/trend-discovery" component={TrendDiscovery} />
      <Route path="/trend-discovery/:id" component={TrendDiscoveryDetail} />
      <Route path="/context-analysis" component={ContextAnalysis} />
      <Route path="/context-analysis/:id" component={ContextAnalysis} />
      <Route path="/pain-analysis" component={PainAnalysis} />
      <Route path="/pain-analysis/:id" component={PainAnalysis} />
      <Route path="/pr-word" component={PrWordDevelopment} />
      <Route path="/pr-word/:id" component={PrWordDevelopment} />
      <Route path="/product-analysis" component={ProductAnalysis} />
      <Route path="/campaigns" component={CampaignList} />
      {/* Legacy redirects */}
      <Route path="/history">{() => <RedirectTo to="/activity?filter=seo" />}</Route>
      <Route path="/trend-insights">{() => <RedirectTo to="/activity?filter=trend" />}</Route>
      <Route path="/campaigns/new" component={CampaignNew} />
      <Route path="/campaigns/:id" component={CampaignDetail} />
      <Route path="/campaigns/:id/report" component={CampaignReport} />
      <Route path="/report/view/:jobId" component={ReportView} />
      <Route path="/admin" component={Admin} />
      <Route path="/admin/logs" component={AdminLogs} />
      {/* Final fallback route */}
      <Route component={NotFound} />
    </Switch>
    </AnimatedPage>
    </Suspense>
    </>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
