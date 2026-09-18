import React from 'react';
import {createRoot} from 'react-dom/client';
import {VideoPlayer} from '../../src/components/VideoPlayer';
import {DetailsModal} from '../../src/components/DetailsModal';
import {ServerLoginModal} from '../../src/components/ServerLoginModal';
import {AppHeader} from '../../src/components/AppHeader';
import {SearchModal} from '../../src/components/SearchModal';
import {HomePortal} from '../../src/components/HomePortal';
import {StreamCard} from '../../src/components/StreamCard';
import {xtreamService} from '../../src/services/xtream';
import '../../src/index.css';
xtreamService.enableDemoMode();
const item = {id:1, type:'vod', name:'UX Test Movie', duration:3600, icon:'', year:'2026', rating:8.4} as any;
const liveItem = {id:2, type:'live', name:'UX Test Live', icon:''} as any;
const seriesItem = {id:3, type:'series', name:'UX Test Series', icon:'', year:'2026', rating:8.1} as any;
const progress = {id:1, type:'vod', title:'UX Test Movie', timestamp:900, duration:3600, poster:''} as any;
function Harness(){
 const [mode,setMode]=React.useState(new URLSearchParams(location.search).get('mode') || 'player');
 return <><button id="opener" onClick={()=>setMode('details')}>Open details</button>
 {mode==='player' && <VideoPlayer item={item} streamUrl="http://example.invalid/movie/test.mkv" onClose={()=>setMode('closed')} onUpdateProgress={()=>{}} />}
 {mode==='details' && <DetailsModal item={item} progress={null} isFavorite={false} isInWatchlist={false} onClose={()=>setMode('closed')} onPlay={()=>{}} onToggleFavorite={()=>{}} onToggleWatchlist={()=>{}} onToggleEpisodeWatched={()=>{}} isEpisodeWatched={()=>false} getSeasonProgress={()=>({watchedCount:0,total:10,percentage:0})} />}
 {mode==='series' && <DetailsModal item={{...item,type:'series'}} progress={null} isFavorite={false} isInWatchlist={false} onClose={()=>setMode('closed')} onPlay={()=>{}} onToggleFavorite={()=>{}} onToggleWatchlist={()=>{}} onToggleEpisodeWatched={()=>{}} isEpisodeWatched={()=>false} getSeasonProgress={()=>({watchedCount:0,total:10,percentage:0})} />}
 {mode==='settings' && <ServerLoginModal isOpen onClose={()=>setMode('closed')} onSuccess={()=>{}} currentCredentials={null} userInfo={null} serverInfo={null} isDemo />}
 {mode==='header' && <AppHeader currentView="home" onNavigateHome={()=>{}} onSelectView={()=>{}} searchQuery="" onSearchChange={()=>{}} onOpenSettings={()=>{}} onRefresh={()=>{}} isRefreshing={false} isDemo />}
 {mode==='search' && <SearchModal isOpen onClose={()=>setMode('closed')} allItems={[item, liveItem, seriesItem]} onSelectItem={()=>{}} activeContentType="all" />}
 {mode==='home' && <HomePortal onSelectSection={()=>{}} liveCount={120} moviesCount={860} seriesCount={240} continueWatchingList={[progress]} onResumeRecent={()=>{}} onClearContinueWatching={()=>{}} />}
 {mode==='card' && <div className="p-6 max-w-xs"><StreamCard item={item} progress={progress} isFavorite={false} isInWatchlist={false} onSelect={()=>{}} onToggleFavorite={()=>{}} onToggleWatchlist={()=>{}} /></div>}
 </>
}
createRoot(document.getElementById('root')!).render(<Harness/>);
