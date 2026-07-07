
        let map;
        let gameState = 'SETUP'; // SETUP, PLAYING, GAMEOVER, VICTORY
        let lastTime = 0;
        let gameLoopId;

        // Game Entities
        let player;
        let zombies = [];
        let facilities = [];
        
        // Coordinates
        let startLatLng = null;
        let endLatLng = null;
        let walkLines = []; // 도로 선형 데이터
        let walkPolygons = []; // 지하철역 등 통과 가능한 건물 다각형 데이터

        // Input State
        const keys = { w: false, a: false, s: false, d: false, ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false };
        let joystickVector = { x: 0, y: 0 };

        // Global Events
        let globalSirenActive = false;
        let globalSirenTimer = 0;
        let zombieSpawnTimer = 0;

        // Initialize Map
        function initMap() {
            // Default to Seoul City Hall
            map = L.map('map', { zoomControl: false }).setView([37.5665, 126.9780], 15);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '&copy; OpenStreetMap contributors',
                maxZoom: 19
            }).addTo(map);
        }

        // 💡 버그 수정: 페이지 로드 시 지도를 생성하도록 함수를 직접 호출합니다.
        initMap();

        // UI Elements
        const toastEl = document.getElementById('toast');
        const startGameBtn = document.getElementById('startGameBtn');
        const startInput = document.getElementById('startInput');
        const endInput = document.getElementById('endInput');
        const btnText = document.getElementById('btnText');
        const loadingSpinner = document.getElementById('loadingSpinner');

        function showToast(msg) {
            toastEl.textContent = msg;
            toastEl.classList.add('show');
            setTimeout(() => toastEl.classList.remove('show'), 3000);
        }

        function setLoading(isLoading) {
            if(isLoading) {
                btnText.textContent = "좌표 검색 중...";
                loadingSpinner.classList.remove('hidden');
                startGameBtn.disabled = true;
            } else {
                btnText.textContent = "귀가 시작";
                loadingSpinner.classList.add('hidden');
                startGameBtn.disabled = false;
            }
        }

        async function geocodeAddress(query) {
            try {
                // 도로명 주소 매칭 확률을 높이기 위해 accept-language 추가
                const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=kr&limit=1&accept-language=ko`);
                const data = await res.json();
                if (data && data.length > 0) {
                    return L.latLng(parseFloat(data[0].lat), parseFloat(data[0].lon));
                }
                return null;
            } catch (e) {
                console.error(e);
                return null;
            }
        }

        function setupAutocomplete(inputId, listId, isStart) {
            const input = document.getElementById(inputId);
            const list = document.getElementById(listId);
            let debounceTimer;

            input.addEventListener('input', (e) => {
                clearTimeout(debounceTimer);
                const query = e.target.value.trim();
                
                // 사용자가 직접 타이핑하여 내용을 변경하면 기존 저장된 좌표 초기화
                if (isStart) startLatLng = null;
                else endLatLng = null;

                if (query.length < 2) {
                    list.classList.add('hidden');
                    return;
                }

                debounceTimer = setTimeout(async () => {
                    try {
                        // Nominatim 검색 API 호출 (최대 5개 추천, 한국어 우선)
                        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=kr&limit=5&accept-language=ko`);
                        const data = await res.json();
                        
                        list.innerHTML = '';
                        if (data && data.length > 0) {
                            data.forEach(item => {
                                const li = document.createElement('li');
                                li.className = 'px-4 py-3 hover:bg-gray-700 cursor-pointer text-sm text-gray-200 border-b border-gray-700 last:border-b-0 transition-colors';
                                
                                // 장소명 및 전체 주소 정제 출력
                                const name = item.name ? `<div class="font-bold text-white mb-1">${item.name}</div>` : '';
                                const address = item.display_name;
                                li.innerHTML = `${name}<div class="text-xs text-gray-400 line-clamp-2">${address}</div>`;
                                
                                // 항목 클릭 시 자동완성 및 좌표 미리 저장
                                li.onclick = () => {
                                    input.value = item.name || item.display_name.split(',')[0];
                                    if (isStart) startLatLng = L.latLng(item.lat, item.lon);
                                    else endLatLng = L.latLng(item.lat, item.lon);
                                    list.classList.add('hidden');
                                };
                                list.appendChild(li);
                            });
                            list.classList.remove('hidden');
                        } else {
                            list.innerHTML = '<li class="px-4 py-3 text-sm text-gray-400 text-center">검색 결과가 없습니다.</li>';
                            list.classList.remove('hidden');
                        }
                    } catch (err) {
                        console.error("Autocomplete error:", err);
                    }
                }, 500); // 500ms 타이핑 딜레이 (서버 과부하 방지)
            });

            // 입력창 및 목록 바깥 영역 클릭 시 추천 리스트 닫기
            document.addEventListener('click', (e) => {
                if (!input.contains(e.target) && !list.contains(e.target)) {
                    list.classList.add('hidden');
                }
            });
        }

        // 출발지 및 도착지 입력창에 자동완성 이벤트 바인딩
        setupAutocomplete('startInput', 'startSuggestions', true);
        setupAutocomplete('endInput', 'endSuggestions', false);

        // GPS Location
        document.getElementById('gpsBtn').addEventListener('click', () => {
            if ("geolocation" in navigator) {
                showToast("GPS 위치 확인 중...");
                navigator.geolocation.getCurrentPosition((pos) => {
                    startLatLng = L.latLng(pos.coords.latitude, pos.coords.longitude);
                    startInput.value = "내 위치 (GPS)";
                    showToast("GPS 위치 적용 완료");
                }, () => {
                    showToast("GPS 권한이 거부되었거나 실패했습니다.");
                });
            } else {
                showToast("GPS를 지원하지 않는 브라우저입니다.");
            }
        });

        // Start Flow
        startGameBtn.addEventListener('click', async () => {
            const startVal = startInput.value.trim();
            const endVal = endInput.value.trim();

            if (!startVal || !endVal) {
                showToast("출발지와 도착지를 모두 입력해주세요.");
                return;
            }

            setLoading(true);

            // Geocode Start if not using GPS and not selected via autocomplete
            if (startVal !== "내 위치 (GPS)" && !startLatLng) {
                startLatLng = await geocodeAddress(startVal);
            }
            
            // Geocode End if not selected via autocomplete
            if (!endLatLng) {
                endLatLng = await geocodeAddress(endVal);
            }

            if (!startLatLng) { setLoading(false); showToast("출발지 주소를 찾을 수 없습니다."); return; }
            if (!endLatLng) { setLoading(false); showToast("도착지 주소를 찾을 수 없습니다."); return; }

            await setupGameEnvironment();
        });

        // 스트리트(도로) 및 지하철역 데이터 추출 함수
        async function fetchRoadsAndStations(bounds) {
            try {
                const paddedBounds = bounds.pad(0.1); 
                const bbox = `${paddedBounds.getSouth()},${paddedBounds.getWest()},${paddedBounds.getNorth()},${paddedBounds.getEast()}`;
                
                // Overpass API: 도로(highway)와 역(station)만 가져옵니다.
                const query = `[out:json][timeout:15];
                (
                  way["highway"](${bbox});
                  way["building"="train_station"](${bbox});
                  way["railway"="station"](${bbox});
                  way["public_transport"="station"](${bbox});
                );
                out geom;`;
                const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;
                
                const response = await fetch(url);
                if(!response.ok) throw new Error("API Error");
                const data = await response.json();
                
                walkLines = [];
                walkPolygons = [];
                
                if(data.elements) {
                    data.elements.forEach(el => {
                        if(!el.geometry) return;
                        
                        // 역(Station)인 경우 - 다각형으로 뚫고 지나갈 수 있는 안전구역
                        const isStation = el.tags && (el.tags.building === 'train_station' || el.tags.railway === 'station' || el.tags.public_transport === 'station');
                        
                        if(isStation && el.geometry.length > 2) { 
                            walkPolygons.push(el.geometry.map(pt => ({lat: pt.lat, lng: pt.lon})));
                        } 
                        // 일반 도로인 경우 - 선분 연결 배열로 저장
                        else if (el.tags && el.tags.highway) {
                            for(let i=0; i<el.geometry.length - 1; i++) {
                                const p1 = el.geometry[i];
                                const p2 = el.geometry[i+1];
                                walkLines.push({
                                    p1: {lat: p1.lat, lng: p1.lon},
                                    p2: {lat: p2.lat, lng: p2.lon},
                                    minLat: Math.min(p1.lat, p2.lat) - 0.0005,
                                    maxLat: Math.max(p1.lat, p2.lat) + 0.0005,
                                    minLng: Math.min(p1.lon, p2.lon) - 0.0005,
                                    maxLng: Math.max(p1.lon, p2.lon) + 0.0005
                                });
                            }
                        }
                    });
                }
            } catch(e) {
                console.error(e);
                showToast("도로 데이터를 불러오는데 실패했습니다. (자유 이동 모드로 진행)");
            }
        }

        // 특정 좌표가 도로 위인지, 혹은 지하철역 내부인지 검증하는 화이트리스트 검사
        function isValidPosition(lat, lng) {
            // 도로 데이터 로딩 실패 등 예외 상황 시 자유이동 허용
            if(walkLines.length === 0 && walkPolygons.length === 0) return true;

            const pt = {lat, lng};
            
            // 1. 역내 폴리곤 내부에 있는지 확인 (지하철역 통과 허용)
            for(let poly of walkPolygons) {
                if(isInsidePolygon(pt, poly)) return true;
            }

            // 2. 도로 선분에서 일정 반경(도로 폭) 내에 있는지 확인
            for(let line of walkLines) {
                // 빠른 AABB 검사로 불필요한 연산 스킵
                if (lat < line.minLat || lat > line.maxLat || lng < line.minLng || lng > line.maxLng) continue;
                
                // 선분과 좌표 간의 최단 거리가 8미터 이내면 유효한 도로로 판정
                if (distanceToSegment(pt, line.p1, line.p2) <= 8) {
                    return true;
                }
            }
            
            return false;
        }

        // 다각형 내부 포함 여부 판정 (Ray-casting Algorithm)
        function isInsidePolygon(point, vs) {
            let x = point.lng, y = point.lat;
            let inside = false;
            for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
                let xi = vs[i].lng, yi = vs[i].lat;
                let xj = vs[j].lng, yj = vs[j].lat;
                let intersect = ((yi > y) != (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
                if (intersect) inside = !inside;
            }
            return inside;
        }

        // 점과 선분 사이의 최단 거리를 미터(Meters) 단위로 계산
        function distanceToSegment(p, v, w) {
            const R = 6371000; // 지구 반지름
            const lat2y = Math.PI / 180 * R;
            const lng2x = Math.PI / 180 * R * Math.cos(p.lat * Math.PI / 180);

            const px = p.lng * lng2x, py = p.lat * lat2y;
            const vx = v.lng * lng2x, vy = v.lat * lat2y;
            const wx = w.lng * lng2x, wy = w.lat * lat2y;

            const l2 = (wx - vx) * (wx - vx) + (wy - vy) * (wy - vy);
            if (l2 === 0) return Math.hypot(px - vx, py - vy); // v와 w가 같은 점인 경우
            
            let t = ((px - vx) * (wx - vx) + (py - vy) * (wy - vy)) / l2;
            t = Math.max(0, Math.min(1, t)); // 선분 내 비율 고정
            
            const projX = vx + t * (wx - vx);
            const projY = vy + t * (wy - vy);
            
            return Math.hypot(px - projX, py - projY);
        }

        // 플레이어 시작 좌표를 가장 가까운 도로로 보정해주는 함수
        function getNearestValidPoint(lat, lng) {
            if(walkLines.length === 0 || isValidPosition(lat, lng)) return {lat, lng};
            
            let minDist = Infinity;
            let bestPt = {lat, lng};
            
            for(let line of walkLines) {
                const d1 = distanceToSegment({lat, lng}, line.p1, line.p1);
                if(d1 < minDist) { minDist = d1; bestPt = line.p1; }
                const d2 = distanceToSegment({lat, lng}, line.p2, line.p2);
                if(d2 < minDist) { minDist = d2; bestPt = line.p2; }
            }
            return bestPt;
        }

        async function setupGameEnvironment() {
            const bounds = L.latLngBounds(startLatLng, endLatLng);

            // 로딩 UI 변경 후 도로 데이터 비동기 로딩 대기
            setLoading(true);
            btnText.textContent = "도로 데이터 로딩 중 (최대 10초)...";
            await fetchRoadsAndStations(bounds);
            setLoading(false);

            document.getElementById('startScreen').classList.add('hidden');
            document.getElementById('hud').classList.remove('hidden');
            gameState = 'PLAYING';

            // Set Map Bounds to encompass start and end
            map.fitBounds(bounds, { padding: [50, 50] });

            // Create Base Markers
            L.marker(startLatLng, { icon: createEmojiIcon('🚉') }).addTo(map).bindPopup('출발지').openPopup();
            L.marker(endLatLng, { icon: createEmojiIcon('🏠') }).addTo(map).bindPopup('도착지');

            // Generate Procedural "Public Data" Facilities based on bounds
            generateFacilities(bounds);

            // Initialize Player (시작 시점에 도로 위로 강제 스냅)
            const startPt = getNearestValidPoint(startLatLng.lat, startLatLng.lng);
            player = new Player(startPt.lat, startPt.lng);

            // Start Game Loop
            lastTime = performance.now();
            requestAnimationFrame(gameLoop);
        }

        function createEmojiIcon(emoji, size = 30) {
            return L.divIcon({
                className: 'custom-div-icon',
                html: `<div class="emoji-marker" style="font-size:${size}px;">${emoji}</div>`,
                iconSize: [size, size],
                iconAnchor: [size/2, size/2]
            });
        }

        function generateFacilities(bounds) {
            const minLat = bounds.getSouth();
            const maxLat = bounds.getNorth();
            const minLng = bounds.getWest();
            const maxLng = bounds.getEast();

            // Scatter facilities randomly within the play area
            const facilityConfig = [
                { type: 'light', count: 30 },
                { type: 'police', count: 5 },
                { type: 'bell', count: 10 }
            ];

            facilityConfig.forEach(config => {
                for(let i = 0; i < config.count; i++) {
                    const lat = minLat + Math.random() * (maxLat - minLat);
                    const lng = minLng + Math.random() * (maxLng - minLng);
                    facilities.push(new Facility(config.type, lat, lng));
                }
            });
        }

        class Player {
            constructor(lat, lng) {
                this.lat = lat;
                this.lng = lng;
                this.latlng = L.latLng(lat, lng);
                this.speed = 8; // meters per second (Running speed)
                this.hp = 3;
                this.invulnerableTime = 0;
                
                this.marker = L.marker(this.latlng, { icon: createEmojiIcon('🏃‍♂️', 40), zIndexOffset: 1000 }).addTo(map);
            }

            update(dt) {
                if(gameState !== 'PLAYING') return;

                let dx = 0; // East/West
                let dy = 0; // North/South

                if (keys.w || keys.ArrowUp) dy += 1;
                if (keys.s || keys.ArrowDown) dy -= 1;
                if (keys.a || keys.ArrowLeft) dx -= 1;
                if (keys.d || keys.ArrowRight) dx += 1;

                if (joystickVector.x !== 0 || joystickVector.y !== 0) {
                    dx = joystickVector.x;
                    dy = -joystickVector.y; // Joystick y is inverted (down is positive)
                }

                const length = Math.sqrt(dx * dx + dy * dy);
                if (length > 0) {
                    dx /= length;
                    dy /= length;
                }

                // Convert meters per second to degrees
                // 1 degree latitude is approx 111,111 meters
                const metersMoved = this.speed * (dt / 1000);
                const latDiff = (dy * metersMoved) / 111111;
                const lngDiff = (dx * metersMoved) / (111111 * Math.cos(this.lat * Math.PI / 180));

                let nextLat = this.lat + latDiff;
                let nextLng = this.lng + lngDiff;

                // 대각선 이동 시 도로 밖으로 나가는 걸 방지하고 도로 축으로 부드럽게 꺾이도록(Sliding) 처리
                if (isValidPosition(nextLat, nextLng)) {
                    this.lat = nextLat;
                    this.lng = nextLng;
                } else {
                    if (isValidPosition(nextLat, this.lng)) {
                        this.lat = nextLat;
                    } else if (isValidPosition(this.lat, nextLng)) {
                        this.lng = nextLng;
                    }
                }

                this.latlng = L.latLng(this.lat, this.lng);
                
                this.marker.setLatLng(this.latlng);

                // Update Camera to follow player smoothly
                map.panTo(this.latlng, { animate: true, duration: 0.1, easeLinearity: 1, noMoveStart: true });

                if (this.invulnerableTime > 0) {
                    this.invulnerableTime -= dt;
                    this.marker.setOpacity(Math.floor(Date.now() / 150) % 2 === 0 ? 0.3 : 1);
                } else {
                    this.marker.setOpacity(1);
                }
            }

            takeDamage() {
                if (this.invulnerableTime <= 0) {
                    this.hp--;
                    this.invulnerableTime = 2000;
                    showToast("좀비에게 공격당했습니다!");
                    updateHUD();
                    if (this.hp <= 0) endGame(false);
                }
            }
        }

        class Zombie {
            constructor(lat, lng) {
                this.lat = lat;
                this.lng = lng;
                this.latlng = L.latLng(lat, lng);
                this.baseSpeed = 6; // meters per second
                this.speed = 6;
                this.state = 'CHASE';
                
                this.marker = L.marker(this.latlng, { icon: createEmojiIcon('🧟', 35), zIndexOffset: 500 }).addTo(map);
            }

            update(dt, playerObj, facilityList) {
                let targetLat = playerObj.lat;
                let targetLng = playerObj.lng;

                // Facility checks (convert distances to meters)
                let nearPolice = false;
                let policeLat, policeLng;
                let inLight = false;

                facilityList.forEach(f => {
                    if(f.type === 'police' && map.distance(this.latlng, f.latlng) < f.radius) {
                        nearPolice = true;
                        policeLat = f.lat;
                        policeLng = f.lng;
                    }
                    if(f.type === 'light' && map.distance(this.latlng, f.latlng) < f.radius) {
                        inLight = true;
                    }
                });

                if (globalSirenActive) {
                    this.state = 'FLEE';
                    targetLat = playerObj.lat; 
                    targetLng = playerObj.lng;
                } else if (nearPolice) {
                    this.state = 'FLEE';
                    targetLat = policeLat;
                    targetLng = policeLng;
                } else {
                    this.state = 'CHASE';
                }

                // Apply logic
                this.speed = inLight && this.state === 'CHASE' ? this.baseSpeed * 0.4 : this.baseSpeed;
                this.marker.setIcon(createEmojiIcon(this.state === 'FLEE' ? '😱' : '🧟', 35));

                // Move calculation
                let dy = targetLat - this.lat;
                let dx = targetLng - this.lng;
                const distDegrees = Math.hypot(dx, dy);

                if (distDegrees > 0) {
                    dy /= distDegrees;
                    dx /= distDegrees;

                    if (this.state === 'FLEE') {
                        dy = -dy; dx = -dx;
                        this.speed = this.baseSpeed * 1.5;
                    }

                    const metersMoved = this.speed * (dt / 1000);
                    const latDiff = (dy * metersMoved) / 111111;
                    const lngDiff = (dx * metersMoved) / (111111 * Math.cos(this.lat * Math.PI / 180));

                    let nextLat = this.lat + latDiff;
                    let nextLng = this.lng + lngDiff;

                    // 좀비 또한 플레이어처럼 도로로만 이동 (충돌 시 슬라이딩)
                    if (isValidPosition(nextLat, nextLng)) {
                        this.lat = nextLat;
                        this.lng = nextLng;
                    } else {
                        if (isValidPosition(nextLat, this.lng)) {
                            this.lat = nextLat;
                        } else if (isValidPosition(this.lat, nextLng)) {
                            this.lng = nextLng;
                        }
                    }

                    this.latlng = L.latLng(this.lat, this.lng);
                    this.marker.setLatLng(this.latlng);
                }

                // Collision with player
                const distToPlayerMeters = map.distance(this.latlng, playerObj.latlng);
                if (this.state === 'CHASE' && distToPlayerMeters < 10) { // 10 meters collision
                    playerObj.takeDamage();
                }
            }

            destroy() {
                map.removeLayer(this.marker);
            }
        }

        class Facility {
            constructor(type, lat, lng) {
                this.type = type;
                this.lat = lat;
                this.lng = lng;
                this.latlng = L.latLng(lat, lng);
                this.radius = 0;
                
                this.bellState = 'IDLE';
                this.countdown = 0;

                this.render();
            }

            render() {
                if (this.type === 'light') {
                    this.radius = 20; // 반경 축소 (40 -> 20)
                    this.circle = L.circle(this.latlng, { radius: this.radius, color: 'yellow', fillColor: '#fde047', fillOpacity: 0.3, weight: 1, border: 'none' }).addTo(map);
                    this.marker = L.marker(this.latlng, { icon: createEmojiIcon('💡', 20) }).addTo(map);
                } 
                else if (this.type === 'police') {
                    this.radius = 40; // 반경 축소 (80 -> 40)
                    this.circle = L.circle(this.latlng, { radius: this.radius, color: 'blue', fillColor: '#3b82f6', fillOpacity: 0.2, weight: 1, dashArray: '5, 5' }).addTo(map);
                    this.marker = L.marker(this.latlng, { icon: createEmojiIcon('🚓', 30) }).addTo(map);
                }
                else if (this.type === 'bell') {
                    this.radius = 10; // 반경 축소 (15 -> 10)
                    this.circle = L.circle(this.latlng, { radius: this.radius, color: 'red', fillColor: '#ef4444', fillOpacity: 0.5, weight: 2 }).addTo(map);
                    this.marker = L.marker(this.latlng, { icon: createEmojiIcon('🚨', 25) }).addTo(map);
                    
                    // Interaction event on Marker and Circle
                    this.marker.on('click', () => this.interact());
                    this.circle.on('click', () => this.interact());
                }
            }

            update(dt) {
                if (this.type === 'bell' && this.bellState === 'COUNTDOWN') {
                    this.countdown -= dt;
                    
                    // Update visual countdown
                    const secs = Math.ceil(this.countdown / 1000);
                    this.marker.setIcon(L.divIcon({
                        className: 'custom-div-icon',
                        html: `<div class="emoji-marker font-bold text-red-500 bg-black/50 rounded-full px-2" style="font-size:16px;">${secs}s</div>`,
                        iconAnchor: [15, 15]
                    }));

                    if (this.countdown <= 0) {
                        triggerGlobalSiren();
                        this.bellState = 'COOLDOWN';
                        this.countdown = 20000; // 20s cooldown
                        this.circle.setStyle({ color: 'gray', fillColor: 'gray' });
                    }
                } else if (this.type === 'bell' && this.bellState === 'COOLDOWN') {
                    this.countdown -= dt;
                    this.marker.setIcon(createEmojiIcon('⏳', 20));
                    if (this.countdown <= 0) {
                        this.bellState = 'IDLE';
                        this.circle.setStyle({ color: 'red', fillColor: '#ef4444' });
                        this.marker.setIcon(createEmojiIcon('🚨', 25));
                    }
                }
            }

            interact() {
                // Check if player is close enough (within 30 meters)
                if(gameState !== 'PLAYING' || this.type !== 'bell' || this.bellState !== 'IDLE') return;
                
                const distToPlayer = map.distance(this.latlng, player.latlng);
                if (distToPlayer > 30) {
                    showToast("안심벨에 더 가까이 다가가야 합니다!");
                    return;
                }

                this.bellState = 'COUNTDOWN';
                this.countdown = 10000;
                showToast("비상벨 작동! 10초 뒤 사이렌이 울립니다.");
            }
        }

        function triggerGlobalSiren() {
            globalSirenActive = true;
            globalSirenTimer = 5000; 
            document.getElementById('sirenAlert').classList.remove('hidden');
            
            // 시각적 피드백: 화면 테두리 반짝임
            const overlay = document.createElement('div');
            overlay.className = 'fixed inset-0 border-[10px] border-red-500/50 pointer-events-none z-[2000] animate-pulse';
            overlay.id = 'sirenOverlay';
            document.body.appendChild(overlay);
        }

        function gameLoop(timestamp) {
            if (gameState !== 'PLAYING') return;

            const dt = timestamp - lastTime;
            lastTime = timestamp;

            // Global Siren Logic
            if (globalSirenActive) {
                globalSirenTimer -= dt;
                if (globalSirenTimer <= 0) {
                    globalSirenActive = false;
                    document.getElementById('sirenAlert').classList.add('hidden');
                    const overlay = document.getElementById('sirenOverlay');
                    if(overlay) overlay.remove();
                }
            }

            player.update(dt);
            facilities.forEach(f => f.update(dt));

            // Spawn Zombies progressively up to a limit
            zombieSpawnTimer += dt;
            if (zombieSpawnTimer > 3000 && zombies.length < 25) {
                zombieSpawnTimer = 0;
                
                let isValidSpawn = false;
                let spawnLat, spawnLng;
                
                // 좀비가 도로 위에 스폰되도록 20번 검사
                for(let attempt=0; attempt<20; attempt++) {
                    const angle = Math.random() * Math.PI * 2;
                    const distMeters = 80 + Math.random() * 70; // 플레이어로부터 80m~150m 떨어진 곳
                    spawnLat = player.lat + (Math.sin(angle) * distMeters) / 111111;
                    spawnLng = player.lng + (Math.cos(angle) * distMeters) / (111111 * Math.cos(player.lat * Math.PI / 180));
                    
                    if(isValidPosition(spawnLat, spawnLng)) {
                        isValidSpawn = true;
                        break;
                    }
                }
                
                // 검사 실패 시(주변 도로 탐색 실패) 랜덤하게 수집된 도로망 중 하나를 선택해 스폰시도
                if (!isValidSpawn && walkLines.length > 0) {
                    for(let attempt=0; attempt<10; attempt++) {
                        const line = walkLines[Math.floor(Math.random() * walkLines.length)];
                        const dist = map.distance([player.lat, player.lng], [line.p1.lat, line.p1.lng]);
                        if (dist > 80 && dist < 250) {
                            spawnLat = line.p1.lat;
                            spawnLng = line.p1.lng;
                            isValidSpawn = true;
                            break;
                        }
                    }
                }

                if(isValidSpawn) {
                    zombies.push(new Zombie(spawnLat, spawnLng));
                }
            }

            // Update Zombies
            zombies.forEach(z => z.update(dt, player, facilities));

            // Win Condition Check
            const distToHome = map.distance(player.latlng, endLatLng);
            updateHUD(distToHome);

            if (distToHome < 20) { // Reach within 20 meters
                endGame(true);
            }

            gameLoopId = requestAnimationFrame(gameLoop);
        }

        function updateHUD(distToHome = null) {
            let hearts = '';
            for(let i=0; i<3; i++) hearts += i < player.hp ? '❤️' : '🖤';
            document.getElementById('healthDisplay').textContent = `체력: ${hearts}`;

            if (distToHome !== null) {
                document.getElementById('distanceDisplay').textContent = `집까지 거리: ${Math.floor(distToHome)}m`;
            }
        }

        function endGame(isVictory) {
            gameState = isVictory ? 'VICTORY' : 'GAMEOVER';
            cancelAnimationFrame(gameLoopId);
            document.getElementById('hud').classList.add('hidden');
            
            if (isVictory) {
                document.getElementById('victoryScreen').classList.remove('hidden');
            } else {
                document.getElementById('gameOverScreen').classList.remove('hidden');
            }
        }

        // Keyboard
        window.addEventListener('keydown', e => { if (keys.hasOwnProperty(e.key.toLowerCase())) keys[e.key.toLowerCase()] = true; else if (keys.hasOwnProperty(e.key)) keys[e.key] = true; });
        window.addEventListener('keyup', e => { if (keys.hasOwnProperty(e.key.toLowerCase())) keys[e.key.toLowerCase()] = false; else if (keys.hasOwnProperty(e.key)) keys[e.key] = false; });

        // Joystick
        const joystickZone = document.getElementById('joystick-zone');
        const joystickKnob = document.getElementById('joystick-knob');
        let isDraggingJoystick = false;

        joystickZone.addEventListener('mousedown', startJoystick);
        joystickZone.addEventListener('touchstart', startJoystick, {passive: false});
        window.addEventListener('mousemove', moveJoystick);
        window.addEventListener('touchmove', moveJoystick, {passive: false});
        window.addEventListener('mouseup', endJoystick);
        window.addEventListener('touchend', endJoystick);

        function startJoystick(e) {
            if(e.target === joystickZone || e.target === joystickKnob) {
                e.preventDefault();
                isDraggingJoystick = true;
                updateJoystickState(e);
            }
        }

        function moveJoystick(e) {
            if (!isDraggingJoystick) return;
            e.preventDefault();
            updateJoystickState(e);
        }

        function endJoystick() {
            isDraggingJoystick = false;
            joystickKnob.style.transform = `translate(-50%, -50%)`;
            joystickVector = { x: 0, y: 0 };
        }

        function updateJoystickState(e) {
            const rect = joystickZone.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            
            let clientX = e.clientX || (e.touches && e.touches[0].clientX);
            let clientY = e.clientY || (e.touches && e.touches[0].clientY);

            let dx = clientX - centerX;
            let dy = clientY - centerY;
            const maxDist = rect.width / 2;
            const dist = Math.hypot(dx, dy);

            if (dist > maxDist) {
                dx = (dx / dist) * maxDist;
                dy = (dy / dist) * maxDist;
            }

            joystickKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
            joystickVector = { x: dx / maxDist, y: dy / maxDist };
        }
    