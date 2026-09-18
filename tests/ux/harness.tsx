import React from 'react';
import {createRoot} from 'react-dom/client';
import {VideoPlayer} from '../../src/components/VideoPlayer';
import {DetailsModal} from '../../src/components/DetailsModal';
import {ServerLoginModal} from '../../src/components/ServerLoginModal';
import {AppHeader} from '../../src/components/AppHeader';
import {xtreamService} from '../../src/services/xtream';
import '../../src/index.css';
xtreamService.enableDemoMode();
const item = {id:1, type:'vod', name:'UX Test Movie', duration:3600, icon:''} as any;
function Harness(){
 const [mode,setMode]=React.useState(new URLSearchParams(location.search).get('mode') || 'player');
 return <><button id="opener" onClick={()=>setMode('details')}>Open details</button>
 {mode==='player' && <VideoPlayer item={item} streamUrl="http://example.invalid/movie/test.mkv" onClose={()=>setMode('closed')} onUpdateProgress={()=>{}} />}
 {mode==='details' && <DetailsModal item={item} progress={null} isFavorite={false} isInWatchlist={false} onClose={()=>setMode('closed')} onPlay={()=>{}} onToggleFavorite={()=>{}} onToggleWatchlist={()=>{}} onToggleEpisodeWatched={()=>{}} isEpisodeWatched={()=>false} getSeasonProgress={()=>({watchedCount:0,total:10,percentage:0})} />}
 {mode==='series' && <DetailsModal item={{...item,type:'series'}} progress={null} isFavorite={false} isInWatchlist={false} onClose={()=>setMode('closed')} onPlay={()=>{}} onToggleFavorite={()=>{}} onToggleWatchlist={()=>{}} onToggleEpisodeWatched={()=>{}} isEpisodeWatched={()=>false} getSeasonProgress={()=>({watchedCount:0,total:10,percentage:0})} />}
 {mode==='settings' && <ServerLoginModal isOpen onClose={()=>setMode('closed')} onSuccess={()=>{}} currentCredentials={null} userInfo={null} serverInfo={null} isDemo />}
 {mode==='header' && <AppHeader currentView="home" onNavigateHome={()=>{}} onSelectView={()=>{}} searchQuery="" onSearchChange={()=>{}} onOpenSettings={()=>{}} onRefresh={()=>{}} isRefreshing={false} isDemo />}
 </>
}
createRoot(document.getElementById('root')!).render(<Harness/>);
