import{r as a,ai as ft,j as p,aj as ut,ak as mt,O as ht,P as ae,al as pt,am as vt,an as gt,a5 as fe}from"./index-DL6D41q_.js";import{C as xt,a as yt,Q as St,O as wt,b as bt,q as Mt}from"./qaStats-Bc3dMWsf.js";import{u as U,a as we,_ as ge,D as Et,V as L,b as be,P as ke,O as $e,v as qe,I as _t,F as Ue,c as xe,d as q,W as At,B as Me,S as Qe,e as Lt,U as Re,f as Ie,M as Pt,g as Q,L as jt,h as zt,i as Ct,C as Xe,N as Ot,m as Ut,j as Rt,p as It,s as Dt,G as Bt,k as Tt}from"./models-Bh1nnAgm.js";import{R as Wt}from"./RoomEnvironment-P58htSNB.js";import{s as Ht,f as Ft,d as ue,b as Nt,c as Vt,e as Gt}from"./stageMath-Npy6Zn5s.js";/* empty css               */import"./index-aUPv3SFq.js";import"./fronts-5BNwTT2r.js";const K=new L,Ee=new L,kt=new L,De=new be;function $t(i,e,t){const s=K.setFromMatrixPosition(i.matrixWorld);s.project(e);const n=t.width/2,o=t.height/2;return[s.x*n+n,-(s.y*o)+o]}function qt(i,e){const t=K.setFromMatrixPosition(i.matrixWorld),s=Ee.setFromMatrixPosition(e.matrixWorld),n=t.sub(s),o=e.getWorldDirection(kt);return n.angleTo(o)>Math.PI/2}function Qt(i,e,t,s){const n=K.setFromMatrixPosition(i.matrixWorld),o=n.clone();o.project(e),De.set(o.x,o.y),t.setFromCamera(De,e);const c=t.intersectObjects(s,!0);if(c.length){const r=c[0].distance;return n.distanceTo(t.ray.origin)<r}return!0}function Xt(i,e){if(e instanceof $e)return e.zoom;if(e instanceof ke){const t=K.setFromMatrixPosition(i.matrixWorld),s=Ee.setFromMatrixPosition(e.matrixWorld),n=e.fov*Math.PI/180,o=t.distanceTo(s);return 1/(2*Math.tan(n/2)*o)}else return 1}function Yt(i,e,t){if(e instanceof ke||e instanceof $e){const s=K.setFromMatrixPosition(i.matrixWorld),n=Ee.setFromMatrixPosition(e.matrixWorld),o=s.distanceTo(n),c=(t[1]-t[0])/(e.far-e.near),r=t[1]-c*e.far;return Math.round(c*o+r)}}const ye=i=>Math.abs(i)<1e-10?0:i;function Ye(i,e,t=""){let s="matrix3d(";for(let n=0;n!==16;n++)s+=ye(e[n]*i.elements[n])+(n!==15?",":")");return t+s}const Zt=(i=>e=>Ye(e,i))([1,-1,1,1,1,-1,1,1,1,-1,1,1,1,-1,1,1]),Kt=(i=>(e,t)=>Ye(e,i(t),"translate(-50%,-50%)"))(i=>[1/i,1/i,1/i,1,-1/i,-1/i,-1/i,-1,1/i,1/i,1/i,1,1,1,1,1]);function Jt(i){return i&&typeof i=="object"&&"current"in i}const me=a.forwardRef(({children:i,eps:e=.001,style:t,className:s,prepend:n,center:o,fullscreen:c,portal:r,distanceFactor:f,sprite:l=!1,transform:d=!1,occlude:u,onOcclude:v,castShadow:m,receiveShadow:x,material:w,geometry:S,zIndexRange:b=[16777271,0],calculatePosition:A=$t,as:h="div",wrapperClass:g,pointerEvents:G="auto",...R},X)=>{const{gl:J,camera:P,scene:Le,size:z,raycaster:et,events:tt,viewport:nt}=U(),[j]=a.useState(()=>document.createElement(h)),ce=a.useRef(),O=a.useRef(null),Pe=a.useRef(0),ee=a.useRef([0,0]),Y=a.useRef(null),le=a.useRef(null),k=(r==null?void 0:r.current)||tt.connected||J.domElement.parentNode,W=a.useRef(null),te=a.useRef(!1),ne=a.useMemo(()=>u&&u!=="blending"||Array.isArray(u)&&u.length&&Jt(u[0]),[u]);a.useLayoutEffect(()=>{const C=J.domElement;u&&u==="blending"?(C.style.zIndex=`${Math.floor(b[0]/2)}`,C.style.position="absolute",C.style.pointerEvents="none"):(C.style.zIndex=null,C.style.position=null,C.style.pointerEvents=null)},[u]),a.useLayoutEffect(()=>{if(O.current){const C=ce.current=ft(j);if(Le.updateMatrixWorld(),d)j.style.cssText="position:absolute;top:0;left:0;pointer-events:none;overflow:hidden;";else{const y=A(O.current,P,z);j.style.cssText=`position:absolute;top:0;left:0;transform:translate3d(${y[0]}px,${y[1]}px,0);transform-origin:0 0;`}return k&&(n?k.prepend(j):k.appendChild(j)),()=>{k&&k.removeChild(j),C.unmount()}}},[k,d]),a.useLayoutEffect(()=>{g&&(j.className=g)},[g]);const je=a.useMemo(()=>d?{position:"absolute",top:0,left:0,width:z.width,height:z.height,transformStyle:"preserve-3d",pointerEvents:"none"}:{position:"absolute",transform:o?"translate3d(-50%,-50%,0)":"none",...c&&{top:-z.height/2,left:-z.width/2,width:z.width,height:z.height},...t},[t,o,c,z,d]),it=a.useMemo(()=>({position:"absolute",pointerEvents:G}),[G]);a.useLayoutEffect(()=>{if(te.current=!1,d){var C;(C=ce.current)==null||C.render(a.createElement("div",{ref:Y,style:je},a.createElement("div",{ref:le,style:it},a.createElement("div",{ref:X,className:s,style:t,children:i}))))}else{var y;(y=ce.current)==null||y.render(a.createElement("div",{ref:X,style:je,className:s,children:i}))}});const $=a.useRef(!0);we(C=>{if(O.current){P.updateMatrixWorld(),O.current.updateWorldMatrix(!0,!1);const y=d?ee.current:A(O.current,P,z);if(d||Math.abs(Pe.current-P.zoom)>e||Math.abs(ee.current[0]-y[0])>e||Math.abs(ee.current[1]-y[1])>e){const H=qt(O.current,P);let T=!1;ne&&(Array.isArray(u)?T=u.map(F=>F.current):u!=="blending"&&(T=[Le]));const Z=$.current;if(T){const F=Qt(O.current,P,et,T);$.current=F&&!H}else $.current=!H;Z!==$.current&&(v?v(!$.current):j.style.display=$.current?"block":"none");const ie=Math.floor(b[0]/2),st=u?ne?[b[0],ie]:[ie-1,0]:b;if(j.style.zIndex=`${Yt(O.current,P,st)}`,d){const[F,Ce]=[z.width/2,z.height/2],de=P.projectionMatrix.elements[5]*Ce,{isOrthographicCamera:Oe,top:ot,left:rt,bottom:at,right:ct}=P,lt=Zt(P.matrixWorldInverse),dt=Oe?`scale(${de})translate(${ye(-(ct+rt)/2)}px,${ye((ot+at)/2)}px)`:`translateZ(${de}px)`;let N=O.current.matrixWorld;l&&(N=P.matrixWorldInverse.clone().transpose().copyPosition(N).scale(O.current.scale),N.elements[3]=N.elements[7]=N.elements[11]=0,N.elements[15]=1),j.style.width=z.width+"px",j.style.height=z.height+"px",j.style.perspective=Oe?"":`${de}px`,Y.current&&le.current&&(Y.current.style.transform=`${dt}${lt}translate(${F}px,${Ce}px)`,le.current.style.transform=Kt(N,1/((f||10)/400)))}else{const F=f===void 0?1:Xt(O.current,P)*f;j.style.transform=`translate3d(${y[0]}px,${y[1]}px,0) scale(${F})`}ee.current=y,Pe.current=P.zoom}}if(!ne&&W.current&&!te.current)if(d){if(Y.current){const y=Y.current.children[0];if(y!=null&&y.clientWidth&&y!=null&&y.clientHeight){const{isOrthographicCamera:H}=P;if(H||S)R.scale&&(Array.isArray(R.scale)?R.scale instanceof L?W.current.scale.copy(R.scale.clone().divideScalar(1)):W.current.scale.set(1/R.scale[0],1/R.scale[1],1/R.scale[2]):W.current.scale.setScalar(1/R.scale));else{const T=(f||10)/400,Z=y.clientWidth*T,ie=y.clientHeight*T;W.current.scale.set(Z,ie,1)}te.current=!0}}}else{const y=j.children[0];if(y!=null&&y.clientWidth&&y!=null&&y.clientHeight){const H=1/nt.factor,T=y.clientWidth*H,Z=y.clientHeight*H;W.current.scale.set(T,Z,1),te.current=!0}W.current.lookAt(C.camera.position)}});const ze=a.useMemo(()=>({vertexShader:d?void 0:`
          /*
            This shader is from the THREE's SpriteMaterial.
            We need to turn the backing plane into a Sprite
            (make it always face the camera) if "transfrom"
            is false.
          */
          #include <common>

          void main() {
            vec2 center = vec2(0., 1.);
            float rotation = 0.0;

            // This is somewhat arbitrary, but it seems to work well
            // Need to figure out how to derive this dynamically if it even matters
            float size = 0.03;

            vec4 mvPosition = modelViewMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
            vec2 scale;
            scale.x = length( vec3( modelMatrix[ 0 ].x, modelMatrix[ 0 ].y, modelMatrix[ 0 ].z ) );
            scale.y = length( vec3( modelMatrix[ 1 ].x, modelMatrix[ 1 ].y, modelMatrix[ 1 ].z ) );

            bool isPerspective = isPerspectiveMatrix( projectionMatrix );
            if ( isPerspective ) scale *= - mvPosition.z;

            vec2 alignedPosition = ( position.xy - ( center - vec2( 0.5 ) ) ) * scale * size;
            vec2 rotatedPosition;
            rotatedPosition.x = cos( rotation ) * alignedPosition.x - sin( rotation ) * alignedPosition.y;
            rotatedPosition.y = sin( rotation ) * alignedPosition.x + cos( rotation ) * alignedPosition.y;
            mvPosition.xy += rotatedPosition;

            gl_Position = projectionMatrix * mvPosition;
          }
      `,fragmentShader:`
        void main() {
          gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
        }
      `}),[d]);return a.createElement("group",ge({},R,{ref:O}),u&&!ne&&a.createElement("mesh",{castShadow:m,receiveShadow:x,ref:W},S||a.createElement("planeGeometry",null),w||a.createElement("shaderMaterial",{side:Et,vertexShader:ze.vertexShader,fragmentShader:ze.fragmentShader})))}),Ze=qe>=125?"uv1":"uv2",Be=new Me,se=new L;class _e extends _t{constructor(){super(),this.isLineSegmentsGeometry=!0,this.type="LineSegmentsGeometry";const e=[-1,2,0,1,2,0,-1,1,0,1,1,0,-1,0,0,1,0,0,-1,-1,0,1,-1,0],t=[-1,2,1,2,-1,1,1,1,-1,-1,1,-1,-1,-2,1,-2],s=[0,2,1,2,3,1,2,4,3,4,5,3,4,6,5,6,7,5];this.setIndex(s),this.setAttribute("position",new Ue(e,3)),this.setAttribute("uv",new Ue(t,2))}applyMatrix4(e){const t=this.attributes.instanceStart,s=this.attributes.instanceEnd;return t!==void 0&&(t.applyMatrix4(e),s.applyMatrix4(e),t.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this}setPositions(e){let t;e instanceof Float32Array?t=e:Array.isArray(e)&&(t=new Float32Array(e));const s=new xe(t,6,1);return this.setAttribute("instanceStart",new q(s,3,0)),this.setAttribute("instanceEnd",new q(s,3,3)),this.computeBoundingBox(),this.computeBoundingSphere(),this}setColors(e,t=3){let s;e instanceof Float32Array?s=e:Array.isArray(e)&&(s=new Float32Array(e));const n=new xe(s,t*2,1);return this.setAttribute("instanceColorStart",new q(n,t,0)),this.setAttribute("instanceColorEnd",new q(n,t,t)),this}fromWireframeGeometry(e){return this.setPositions(e.attributes.position.array),this}fromEdgesGeometry(e){return this.setPositions(e.attributes.position.array),this}fromMesh(e){return this.fromWireframeGeometry(new At(e.geometry)),this}fromLineSegments(e){const t=e.geometry;return this.setPositions(t.attributes.position.array),this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new Me);const e=this.attributes.instanceStart,t=this.attributes.instanceEnd;e!==void 0&&t!==void 0&&(this.boundingBox.setFromBufferAttribute(e),Be.setFromBufferAttribute(t),this.boundingBox.union(Be))}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new Qe),this.boundingBox===null&&this.computeBoundingBox();const e=this.attributes.instanceStart,t=this.attributes.instanceEnd;if(e!==void 0&&t!==void 0){const s=this.boundingSphere.center;this.boundingBox.getCenter(s);let n=0;for(let o=0,c=e.count;o<c;o++)se.fromBufferAttribute(e,o),n=Math.max(n,s.distanceToSquared(se)),se.fromBufferAttribute(t,o),n=Math.max(n,s.distanceToSquared(se));this.boundingSphere.radius=Math.sqrt(n),isNaN(this.boundingSphere.radius)&&console.error("THREE.LineSegmentsGeometry.computeBoundingSphere(): Computed radius is NaN. The instanced position data is likely to have NaN values.",this)}}toJSON(){}applyMatrix(e){return console.warn("THREE.LineSegmentsGeometry: applyMatrix() has been renamed to applyMatrix4()."),this.applyMatrix4(e)}}class Ke extends _e{constructor(){super(),this.isLineGeometry=!0,this.type="LineGeometry"}setPositions(e){const t=e.length-3,s=new Float32Array(2*t);for(let n=0;n<t;n+=3)s[2*n]=e[n],s[2*n+1]=e[n+1],s[2*n+2]=e[n+2],s[2*n+3]=e[n+3],s[2*n+4]=e[n+4],s[2*n+5]=e[n+5];return super.setPositions(s),this}setColors(e,t=3){const s=e.length-t,n=new Float32Array(2*s);if(t===3)for(let o=0;o<s;o+=t)n[2*o]=e[o],n[2*o+1]=e[o+1],n[2*o+2]=e[o+2],n[2*o+3]=e[o+3],n[2*o+4]=e[o+4],n[2*o+5]=e[o+5];else for(let o=0;o<s;o+=t)n[2*o]=e[o],n[2*o+1]=e[o+1],n[2*o+2]=e[o+2],n[2*o+3]=e[o+3],n[2*o+4]=e[o+4],n[2*o+5]=e[o+5],n[2*o+6]=e[o+6],n[2*o+7]=e[o+7];return super.setColors(n,t),this}fromLine(e){const t=e.geometry;return this.setPositions(t.attributes.position.array),this}}class Ae extends Lt{constructor(e){super({type:"LineMaterial",uniforms:Re.clone(Re.merge([Ie.common,Ie.fog,{worldUnits:{value:1},linewidth:{value:1},resolution:{value:new be(1,1)},dashOffset:{value:0},dashScale:{value:1},dashSize:{value:1},gapSize:{value:1}}])),vertexShader:`
				#include <common>
				#include <fog_pars_vertex>
				#include <logdepthbuf_pars_vertex>
				#include <clipping_planes_pars_vertex>

				uniform float linewidth;
				uniform vec2 resolution;

				attribute vec3 instanceStart;
				attribute vec3 instanceEnd;

				#ifdef USE_COLOR
					#ifdef USE_LINE_COLOR_ALPHA
						varying vec4 vLineColor;
						attribute vec4 instanceColorStart;
						attribute vec4 instanceColorEnd;
					#else
						varying vec3 vLineColor;
						attribute vec3 instanceColorStart;
						attribute vec3 instanceColorEnd;
					#endif
				#endif

				#ifdef WORLD_UNITS

					varying vec4 worldPos;
					varying vec3 worldStart;
					varying vec3 worldEnd;

					#ifdef USE_DASH

						varying vec2 vUv;

					#endif

				#else

					varying vec2 vUv;

				#endif

				#ifdef USE_DASH

					uniform float dashScale;
					attribute float instanceDistanceStart;
					attribute float instanceDistanceEnd;
					varying float vLineDistance;

				#endif

				void trimSegment( const in vec4 start, inout vec4 end ) {

					// trim end segment so it terminates between the camera plane and the near plane

					// conservative estimate of the near plane
					float a = projectionMatrix[ 2 ][ 2 ]; // 3nd entry in 3th column
					float b = projectionMatrix[ 3 ][ 2 ]; // 3nd entry in 4th column
					float nearEstimate = - 0.5 * b / a;

					float alpha = ( nearEstimate - start.z ) / ( end.z - start.z );

					end.xyz = mix( start.xyz, end.xyz, alpha );

				}

				void main() {

					#ifdef USE_COLOR

						vLineColor = ( position.y < 0.5 ) ? instanceColorStart : instanceColorEnd;

					#endif

					#ifdef USE_DASH

						vLineDistance = ( position.y < 0.5 ) ? dashScale * instanceDistanceStart : dashScale * instanceDistanceEnd;
						vUv = uv;

					#endif

					float aspect = resolution.x / resolution.y;

					// camera space
					vec4 start = modelViewMatrix * vec4( instanceStart, 1.0 );
					vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );

					#ifdef WORLD_UNITS

						worldStart = start.xyz;
						worldEnd = end.xyz;

					#else

						vUv = uv;

					#endif

					// special case for perspective projection, and segments that terminate either in, or behind, the camera plane
					// clearly the gpu firmware has a way of addressing this issue when projecting into ndc space
					// but we need to perform ndc-space calculations in the shader, so we must address this issue directly
					// perhaps there is a more elegant solution -- WestLangley

					bool perspective = ( projectionMatrix[ 2 ][ 3 ] == - 1.0 ); // 4th entry in the 3rd column

					if ( perspective ) {

						if ( start.z < 0.0 && end.z >= 0.0 ) {

							trimSegment( start, end );

						} else if ( end.z < 0.0 && start.z >= 0.0 ) {

							trimSegment( end, start );

						}

					}

					// clip space
					vec4 clipStart = projectionMatrix * start;
					vec4 clipEnd = projectionMatrix * end;

					// ndc space
					vec3 ndcStart = clipStart.xyz / clipStart.w;
					vec3 ndcEnd = clipEnd.xyz / clipEnd.w;

					// direction
					vec2 dir = ndcEnd.xy - ndcStart.xy;

					// account for clip-space aspect ratio
					dir.x *= aspect;
					dir = normalize( dir );

					#ifdef WORLD_UNITS

						// get the offset direction as perpendicular to the view vector
						vec3 worldDir = normalize( end.xyz - start.xyz );
						vec3 offset;
						if ( position.y < 0.5 ) {

							offset = normalize( cross( start.xyz, worldDir ) );

						} else {

							offset = normalize( cross( end.xyz, worldDir ) );

						}

						// sign flip
						if ( position.x < 0.0 ) offset *= - 1.0;

						float forwardOffset = dot( worldDir, vec3( 0.0, 0.0, 1.0 ) );

						// don't extend the line if we're rendering dashes because we
						// won't be rendering the endcaps
						#ifndef USE_DASH

							// extend the line bounds to encompass  endcaps
							start.xyz += - worldDir * linewidth * 0.5;
							end.xyz += worldDir * linewidth * 0.5;

							// shift the position of the quad so it hugs the forward edge of the line
							offset.xy -= dir * forwardOffset;
							offset.z += 0.5;

						#endif

						// endcaps
						if ( position.y > 1.0 || position.y < 0.0 ) {

							offset.xy += dir * 2.0 * forwardOffset;

						}

						// adjust for linewidth
						offset *= linewidth * 0.5;

						// set the world position
						worldPos = ( position.y < 0.5 ) ? start : end;
						worldPos.xyz += offset;

						// project the worldpos
						vec4 clip = projectionMatrix * worldPos;

						// shift the depth of the projected points so the line
						// segments overlap neatly
						vec3 clipPose = ( position.y < 0.5 ) ? ndcStart : ndcEnd;
						clip.z = clipPose.z * clip.w;

					#else

						vec2 offset = vec2( dir.y, - dir.x );
						// undo aspect ratio adjustment
						dir.x /= aspect;
						offset.x /= aspect;

						// sign flip
						if ( position.x < 0.0 ) offset *= - 1.0;

						// endcaps
						if ( position.y < 0.0 ) {

							offset += - dir;

						} else if ( position.y > 1.0 ) {

							offset += dir;

						}

						// adjust for linewidth
						offset *= linewidth;

						// adjust for clip-space to screen-space conversion // maybe resolution should be based on viewport ...
						offset /= resolution.y;

						// select end
						vec4 clip = ( position.y < 0.5 ) ? clipStart : clipEnd;

						// back to clip space
						offset *= clip.w;

						clip.xy += offset;

					#endif

					gl_Position = clip;

					vec4 mvPosition = ( position.y < 0.5 ) ? start : end; // this is an approximation

					#include <logdepthbuf_vertex>
					#include <clipping_planes_vertex>
					#include <fog_vertex>

				}
			`,fragmentShader:`
				uniform vec3 diffuse;
				uniform float opacity;
				uniform float linewidth;

				#ifdef USE_DASH

					uniform float dashOffset;
					uniform float dashSize;
					uniform float gapSize;

				#endif

				varying float vLineDistance;

				#ifdef WORLD_UNITS

					varying vec4 worldPos;
					varying vec3 worldStart;
					varying vec3 worldEnd;

					#ifdef USE_DASH

						varying vec2 vUv;

					#endif

				#else

					varying vec2 vUv;

				#endif

				#include <common>
				#include <fog_pars_fragment>
				#include <logdepthbuf_pars_fragment>
				#include <clipping_planes_pars_fragment>

				#ifdef USE_COLOR
					#ifdef USE_LINE_COLOR_ALPHA
						varying vec4 vLineColor;
					#else
						varying vec3 vLineColor;
					#endif
				#endif

				vec2 closestLineToLine(vec3 p1, vec3 p2, vec3 p3, vec3 p4) {

					float mua;
					float mub;

					vec3 p13 = p1 - p3;
					vec3 p43 = p4 - p3;

					vec3 p21 = p2 - p1;

					float d1343 = dot( p13, p43 );
					float d4321 = dot( p43, p21 );
					float d1321 = dot( p13, p21 );
					float d4343 = dot( p43, p43 );
					float d2121 = dot( p21, p21 );

					float denom = d2121 * d4343 - d4321 * d4321;

					float numer = d1343 * d4321 - d1321 * d4343;

					mua = numer / denom;
					mua = clamp( mua, 0.0, 1.0 );
					mub = ( d1343 + d4321 * ( mua ) ) / d4343;
					mub = clamp( mub, 0.0, 1.0 );

					return vec2( mua, mub );

				}

				void main() {

					#include <clipping_planes_fragment>

					#ifdef USE_DASH

						if ( vUv.y < - 1.0 || vUv.y > 1.0 ) discard; // discard endcaps

						if ( mod( vLineDistance + dashOffset, dashSize + gapSize ) > dashSize ) discard; // todo - FIX

					#endif

					float alpha = opacity;

					#ifdef WORLD_UNITS

						// Find the closest points on the view ray and the line segment
						vec3 rayEnd = normalize( worldPos.xyz ) * 1e5;
						vec3 lineDir = worldEnd - worldStart;
						vec2 params = closestLineToLine( worldStart, worldEnd, vec3( 0.0, 0.0, 0.0 ), rayEnd );

						vec3 p1 = worldStart + lineDir * params.x;
						vec3 p2 = rayEnd * params.y;
						vec3 delta = p1 - p2;
						float len = length( delta );
						float norm = len / linewidth;

						#ifndef USE_DASH

							#ifdef USE_ALPHA_TO_COVERAGE

								float dnorm = fwidth( norm );
								alpha = 1.0 - smoothstep( 0.5 - dnorm, 0.5 + dnorm, norm );

							#else

								if ( norm > 0.5 ) {

									discard;

								}

							#endif

						#endif

					#else

						#ifdef USE_ALPHA_TO_COVERAGE

							// artifacts appear on some hardware if a derivative is taken within a conditional
							float a = vUv.x;
							float b = ( vUv.y > 0.0 ) ? vUv.y - 1.0 : vUv.y + 1.0;
							float len2 = a * a + b * b;
							float dlen = fwidth( len2 );

							if ( abs( vUv.y ) > 1.0 ) {

								alpha = 1.0 - smoothstep( 1.0 - dlen, 1.0 + dlen, len2 );

							}

						#else

							if ( abs( vUv.y ) > 1.0 ) {

								float a = vUv.x;
								float b = ( vUv.y > 0.0 ) ? vUv.y - 1.0 : vUv.y + 1.0;
								float len2 = a * a + b * b;

								if ( len2 > 1.0 ) discard;

							}

						#endif

					#endif

					vec4 diffuseColor = vec4( diffuse, alpha );
					#ifdef USE_COLOR
						#ifdef USE_LINE_COLOR_ALPHA
							diffuseColor *= vLineColor;
						#else
							diffuseColor.rgb *= vLineColor;
						#endif
					#endif

					#include <logdepthbuf_fragment>

					gl_FragColor = diffuseColor;

					#include <tonemapping_fragment>
					#include <${qe>=154?"colorspace_fragment":"encodings_fragment"}>
					#include <fog_fragment>
					#include <premultiplied_alpha_fragment>

				}
			`,clipping:!0}),this.isLineMaterial=!0,this.onBeforeCompile=function(){this.transparent?this.defines.USE_LINE_COLOR_ALPHA="1":delete this.defines.USE_LINE_COLOR_ALPHA},Object.defineProperties(this,{color:{enumerable:!0,get:function(){return this.uniforms.diffuse.value},set:function(t){this.uniforms.diffuse.value=t}},worldUnits:{enumerable:!0,get:function(){return"WORLD_UNITS"in this.defines},set:function(t){t===!0?this.defines.WORLD_UNITS="":delete this.defines.WORLD_UNITS}},linewidth:{enumerable:!0,get:function(){return this.uniforms.linewidth.value},set:function(t){this.uniforms.linewidth.value=t}},dashed:{enumerable:!0,get:function(){return"USE_DASH"in this.defines},set(t){!!t!="USE_DASH"in this.defines&&(this.needsUpdate=!0),t===!0?this.defines.USE_DASH="":delete this.defines.USE_DASH}},dashScale:{enumerable:!0,get:function(){return this.uniforms.dashScale.value},set:function(t){this.uniforms.dashScale.value=t}},dashSize:{enumerable:!0,get:function(){return this.uniforms.dashSize.value},set:function(t){this.uniforms.dashSize.value=t}},dashOffset:{enumerable:!0,get:function(){return this.uniforms.dashOffset.value},set:function(t){this.uniforms.dashOffset.value=t}},gapSize:{enumerable:!0,get:function(){return this.uniforms.gapSize.value},set:function(t){this.uniforms.gapSize.value=t}},opacity:{enumerable:!0,get:function(){return this.uniforms.opacity.value},set:function(t){this.uniforms.opacity.value=t}},resolution:{enumerable:!0,get:function(){return this.uniforms.resolution.value},set:function(t){this.uniforms.resolution.value.copy(t)}},alphaToCoverage:{enumerable:!0,get:function(){return"USE_ALPHA_TO_COVERAGE"in this.defines},set:function(t){!!t!="USE_ALPHA_TO_COVERAGE"in this.defines&&(this.needsUpdate=!0),t===!0?(this.defines.USE_ALPHA_TO_COVERAGE="",this.extensions.derivatives=!0):(delete this.defines.USE_ALPHA_TO_COVERAGE,this.extensions.derivatives=!1)}}}),this.setValues(e)}}const he=new Q,Te=new L,We=new L,M=new Q,E=new Q,I=new Q,pe=new L,ve=new zt,_=new jt,He=new L,oe=new Me,re=new Qe,D=new Q;let B,V;function Fe(i,e,t){return D.set(0,0,-e,1).applyMatrix4(i.projectionMatrix),D.multiplyScalar(1/D.w),D.x=V/t.width,D.y=V/t.height,D.applyMatrix4(i.projectionMatrixInverse),D.multiplyScalar(1/D.w),Math.abs(Math.max(D.x,D.y))}function en(i,e){const t=i.matrixWorld,s=i.geometry,n=s.attributes.instanceStart,o=s.attributes.instanceEnd,c=Math.min(s.instanceCount,n.count);for(let r=0,f=c;r<f;r++){_.start.fromBufferAttribute(n,r),_.end.fromBufferAttribute(o,r),_.applyMatrix4(t);const l=new L,d=new L;B.distanceSqToSegment(_.start,_.end,d,l),d.distanceTo(l)<V*.5&&e.push({point:d,pointOnLine:l,distance:B.origin.distanceTo(d),object:i,face:null,faceIndex:r,uv:null,[Ze]:null})}}function tn(i,e,t){const s=e.projectionMatrix,o=i.material.resolution,c=i.matrixWorld,r=i.geometry,f=r.attributes.instanceStart,l=r.attributes.instanceEnd,d=Math.min(r.instanceCount,f.count),u=-e.near;B.at(1,I),I.w=1,I.applyMatrix4(e.matrixWorldInverse),I.applyMatrix4(s),I.multiplyScalar(1/I.w),I.x*=o.x/2,I.y*=o.y/2,I.z=0,pe.copy(I),ve.multiplyMatrices(e.matrixWorldInverse,c);for(let v=0,m=d;v<m;v++){if(M.fromBufferAttribute(f,v),E.fromBufferAttribute(l,v),M.w=1,E.w=1,M.applyMatrix4(ve),E.applyMatrix4(ve),M.z>u&&E.z>u)continue;if(M.z>u){const h=M.z-E.z,g=(M.z-u)/h;M.lerp(E,g)}else if(E.z>u){const h=E.z-M.z,g=(E.z-u)/h;E.lerp(M,g)}M.applyMatrix4(s),E.applyMatrix4(s),M.multiplyScalar(1/M.w),E.multiplyScalar(1/E.w),M.x*=o.x/2,M.y*=o.y/2,E.x*=o.x/2,E.y*=o.y/2,_.start.copy(M),_.start.z=0,_.end.copy(E),_.end.z=0;const w=_.closestPointToPointParameter(pe,!0);_.at(w,He);const S=Ct.lerp(M.z,E.z,w),b=S>=-1&&S<=1,A=pe.distanceTo(He)<V*.5;if(b&&A){_.start.fromBufferAttribute(f,v),_.end.fromBufferAttribute(l,v),_.start.applyMatrix4(c),_.end.applyMatrix4(c);const h=new L,g=new L;B.distanceSqToSegment(_.start,_.end,g,h),t.push({point:g,pointOnLine:h,distance:B.origin.distanceTo(g),object:i,face:null,faceIndex:v,uv:null,[Ze]:null})}}}class Je extends Pt{constructor(e=new _e,t=new Ae({color:Math.random()*16777215})){super(e,t),this.isLineSegments2=!0,this.type="LineSegments2"}computeLineDistances(){const e=this.geometry,t=e.attributes.instanceStart,s=e.attributes.instanceEnd,n=new Float32Array(2*t.count);for(let c=0,r=0,f=t.count;c<f;c++,r+=2)Te.fromBufferAttribute(t,c),We.fromBufferAttribute(s,c),n[r]=r===0?0:n[r-1],n[r+1]=n[r]+Te.distanceTo(We);const o=new xe(n,2,1);return e.setAttribute("instanceDistanceStart",new q(o,1,0)),e.setAttribute("instanceDistanceEnd",new q(o,1,1)),this}raycast(e,t){const s=this.material.worldUnits,n=e.camera;n===null&&!s&&console.error('LineSegments2: "Raycaster.camera" needs to be set in order to raycast against LineSegments2 while worldUnits is set to false.');const o=e.params.Line2!==void 0&&e.params.Line2.threshold||0;B=e.ray;const c=this.matrixWorld,r=this.geometry,f=this.material;V=f.linewidth+o,r.boundingSphere===null&&r.computeBoundingSphere(),re.copy(r.boundingSphere).applyMatrix4(c);let l;if(s)l=V*.5;else{const u=Math.max(n.near,re.distanceToPoint(B.origin));l=Fe(n,u,f.resolution)}if(re.radius+=l,B.intersectsSphere(re)===!1)return;r.boundingBox===null&&r.computeBoundingBox(),oe.copy(r.boundingBox).applyMatrix4(c);let d;if(s)d=V*.5;else{const u=Math.max(n.near,oe.distanceToPoint(B.origin));d=Fe(n,u,f.resolution)}oe.expandByScalar(d),B.intersectsBox(oe)!==!1&&(s?en(this,t):tn(this,n,t))}onBeforeRender(e){const t=this.material.uniforms;t&&t.resolution&&(e.getViewport(he),this.material.uniforms.resolution.value.set(he.z,he.w))}}class nn extends Je{constructor(e=new Ke,t=new Ae({color:Math.random()*16777215})){super(e,t),this.isLine2=!0,this.type="Line2"}}const sn=a.forwardRef(function({points:e,color:t=16777215,vertexColors:s,linewidth:n,lineWidth:o,segments:c,dashed:r,...f},l){var d,u;const v=U(b=>b.size),m=a.useMemo(()=>c?new Je:new nn,[c]),[x]=a.useState(()=>new Ae),w=(s==null||(d=s[0])==null?void 0:d.length)===4?4:3,S=a.useMemo(()=>{const b=c?new _e:new Ke,A=e.map(h=>{const g=Array.isArray(h);return h instanceof L||h instanceof Q?[h.x,h.y,h.z]:h instanceof be?[h.x,h.y,0]:g&&h.length===3?[h[0],h[1],h[2]]:g&&h.length===2?[h[0],h[1],0]:h});if(b.setPositions(A.flat()),s){t=16777215;const h=s.map(g=>g instanceof Xe?g.toArray():g);b.setColors(h.flat(),w)}return b},[e,c,s,w]);return a.useLayoutEffect(()=>{m.computeLineDistances()},[e,m]),a.useLayoutEffect(()=>{r?x.defines.USE_DASH="":delete x.defines.USE_DASH,x.needsUpdate=!0},[r,x]),a.useEffect(()=>()=>{S.dispose(),x.dispose()},[S]),a.createElement("primitive",ge({object:m,ref:l},f),a.createElement("primitive",{object:S,attach:"geometry"}),a.createElement("primitive",ge({object:x,attach:"material",color:t,vertexColors:!!s,resolution:[v.width,v.height],linewidth:(u=n??o)!==null&&u!==void 0?u:1,dashed:r,transparent:w===4},f)))}),Se=30,Ne=1,Ve={inner:"#fbf9f5",outer:"#e8e1d5"};function on(i,e,t){const s=t??i.widthIn,n=i.depthIn,o=e?ut(i,e):mt(i,ht(i,ae)),c={id:"stage",productId:i.id,x:0,y:0,rotation:0,...o,widthIn:s};return{r:{item:c,product:i,w:s,d:n,box:{minX:-s/2,minY:-n/2,maxX:s/2,maxY:n/2},z0:i.elevationIn,z1:i.elevationIn+i.heightIn},finish:pt(c,i,ae)}}function Ge(){try{return matchMedia("(prefers-reduced-motion: reduce)").matches}catch{return!1}}function rn(){const i=U(s=>s.gl),e=U(s=>s.scene),t=U(s=>s.invalidate);return a.useLayoutEffect(()=>{const s=new Rt(i),n=new Wt,o=s.fromScene(n,.04);return n.dispose(),s.dispose(),e.environment=o.texture,t(),()=>{e.environment===o.texture&&(e.environment=null),o.dispose()}},[i,e,t]),null}function an({root:i}){const e=a.useMemo(()=>new Map,[]);return a.useEffect(()=>()=>{e.forEach(t=>t.dispose()),e.clear()},[e]),we(()=>{var t;(t=i.current)==null||t.traverse(s=>{const n=s;if(!n.isMesh||Array.isArray(n.material))return;const o=n.material;if(!(o!=null&&o.isMeshPhysicalMaterial)||!o.transparent||o.transmission>0||o.opacity>=.97)return;let c=e.get(o);c||(c=new Tt({color:o.color.clone().lerp(new Xe("#ffffff"),o.opacity<.5?.6:0),roughness:Math.min(o.roughness,.06),metalness:0,transmission:1,thickness:.25,ior:1.5,clearcoat:1,clearcoatRoughness:.03,side:o.side}),e.set(o,c)),n.material=c})},-2),null}function cn({r:i,finish:e,ctx:t,onModel:s}){var l;const{product:n}=i,o=n.source!=="missing"?(l=n.model)==null?void 0:l.url:void 0,c=gt(n)?p.jsx(wt,{r:i,surfaces:ae,ctx:t,bare:!0}):It({r:i,finish:e,ctx:t}),r=a.useMemo(()=>({w:i.w,h:n.heightIn,d:n.depthIn}),[i.w,n.heightIn,n.depthIn]),f=a.useMemo(()=>Dt(e,t),[e.id,e.hex,e.material,t]);return a.useEffect(()=>{o||s(!0)},[o]),o?p.jsx("group",{position:[0,n.elevationIn,0],children:p.jsx(Bt,{url:o,target:r,slots:f,onReady:s,fallback:p.jsx("group",{position:[0,-n.elevationIn,0],children:c})})}):c}function ln({frame:i,w:e,d:t,h:s}){const n=a.useRef(null),o=U(g=>g.camera),c=U(g=>g.invalidate),{off:r,tick:f}=Vt(e,t),l=i.bottom+.3,d=-e/2,u=e/2,v=-t/2,m=t/2,x=m+r,w=u+r,S=d-r,b=i.bottom,A=i.bottom+s,h=a.useMemo(()=>[[d,l,x],[u,l,x],[d,l,x-f],[d,l,x+f],[u,l,x-f],[u,l,x+f],[w,l,v],[w,l,m],[w-f,l,v],[w+f,l,v],[w-f,l,m],[w+f,l,m],[S,b,m],[S,A,m],[S-f,b,m],[S+f,b,m],[S-f,A,m],[S+f,A,m]],[d,u,v,m,x,w,S,l,b,A,f]);return a.useEffect(()=>{var g;o.layers.enable(Ne),(g=n.current)==null||g.traverse(G=>G.layers.set(Ne)),c()},[o,c,h]),p.jsxs("group",{ref:n,name:"stage-dims",children:[p.jsx(sn,{points:h,segments:!0,color:"#c2542d",lineWidth:1.6,depthTest:!1,renderOrder:10}),p.jsxs(me,{position:[0,l,x+f*1.6],center:!0,className:"stage-dim",zIndexRange:[5,0],children:[p.jsx("b",{children:"W"})," ",ue(e,fe)]}),p.jsxs(me,{position:[w+f*1.6,l,0],center:!0,className:"stage-dim",zIndexRange:[5,0],children:[p.jsx("b",{children:"D"})," ",ue(t,fe)]}),p.jsxs(me,{position:[S-f*1.6,(b+A)/2,m],center:!0,className:"stage-dim",zIndexRange:[5,0],children:[p.jsx("b",{children:"H"})," ",ue(s,fe)]})]})}function dn({frame:i,autoRotate:e,onInteract:t}){const s=a.useRef(null),n=U(d=>d.camera),o=U(d=>d.size),c=U(d=>d.invalidate),r=o.width/Math.max(1,o.height),f=Math.round(r*20),l=a.useMemo(()=>Nt(i,Se,f/20),[i,f]);return a.useLayoutEffect(()=>{n.fov=Se,n.near=Math.max(.02,l.radius/50),n.far=l.distance*8+10,n.position.set(...l.position),n.updateProjectionMatrix();const d=s.current;d&&(d.target.set(...l.target),d.update()),c()},[l,n,c]),p.jsx(bt,{ref:s,makeDefault:!0,enablePan:!1,enableDamping:!0,dampingFactor:.09,autoRotate:e,autoRotateSpeed:1.1,minDistance:l.minDistance,maxDistance:l.maxDistance,minPolarAngle:.12,maxPolarAngle:Math.PI/2-.03,onStart:t})}function fn(i,e,t){const s=i.createRadialGradient(e/2,t*.42,0,e/2,t*.42,Math.max(e,t)*.75);s.addColorStop(0,Ve.inner),s.addColorStop(1,Ve.outer),i.fillStyle=s,i.fillRect(0,0,e,t)}function un(i,e,t){const s=i(),{gl:n,scene:o,invalidate:c}=s,r=s.camera,f=s.controls,l=(f==null?void 0:f.target.clone())??new L,d=o.getObjectByName("stage-dims"),u=Math.min(4096,n.capabilities.maxTextureSize),v=Math.max(64,Math.min(Math.round(t),u)),m={pos:r.position.clone(),quat:r.quaternion.clone(),aspect:r.aspect,pr:n.getPixelRatio(),dims:(d==null?void 0:d.visible)??!1},x=document.createElement("canvas");x.width=x.height=v;try{d&&(d.visible=!1);const w=r.position.clone().sub(l).normalize();r.aspect=1,r.position.copy(l).addScaledVector(w,Gt(e,r.fov,1,1.02)),r.lookAt(l),r.updateProjectionMatrix(),r.updateMatrixWorld(),n.setPixelRatio(1),n.setSize(v,v,!1),n.render(o,r);const S=x.getContext("2d");if(!S)throw new Error("This browser can’t make the image.");fn(S,v,v),S.drawImage(n.domElement,0,0,v,v)}finally{d&&(d.visible=m.dims),r.position.copy(m.pos),r.quaternion.copy(m.quat),r.aspect=m.aspect,r.updateProjectionMatrix(),r.updateMatrixWorld(),n.setPixelRatio(m.pr),n.setSize(s.size.width,s.size.height,!1),c()}return x}function mn({radius:i,onStill:e}){const t=U(n=>n.get),s=a.useRef(i);return s.current=i,a.useEffect(()=>{const n=async o=>un(t,s.current,o);return e==null||e(n),Mt({stage:{get:t,renderStill:async o=>{const c=await n(o);return{width:c.width,height:c.height}}}}),()=>e==null?void 0:e(null)},[t,e]),null}function hn({ready:i,onReady:e}){const t=a.useRef(!1),s=U(n=>n.invalidate);return a.useEffect(()=>{i&&s()},[i,s]),we(()=>{!i||t.current||(t.current=!0,requestAnimationFrame(()=>e()))}),null}function pn({product:i,finishId:e,widthIn:t,showDims:s,autoRotate:n,onReady:o,onStill:c}){var X;const{r,finish:f}=a.useMemo(()=>on(i,e,t),[i,e,t]),l=a.useMemo(()=>Ht({w:r.w,d:i.depthIn,h:i.heightIn,elevationIn:i.elevationIn,kind:i.kind}),[r.w,i.depthIn,i.heightIn,i.elevationIn,i.kind]),d=a.useMemo(()=>Ft(l,r.w,i.depthIn),[l,r.w,i.depthIn]),u=a.useMemo(()=>Ut(ae,{ceilingIn:l.ceilingIn}),[l.ceilingIn]),v=i.source!=="missing"&&((X=i.model)==null?void 0:X.url)||null,[m,x]=a.useState(null),w=m!==null&&m.url===v,[S,b]=a.useState(()=>n&&!Ge()),A=a.useRef(null),{min:h,max:g}=l.box,G=Math.hypot(g[0]-h[0],g[1]-h[1],g[2]-h[2])/24,R=Math.max(r.w,i.depthIn)/12;return a.useEffect(()=>b(n&&!Ge()),[n]),p.jsxs(p.Fragment,{children:[p.jsx(rn,{}),p.jsx("ambientLight",{intensity:.12}),p.jsx("directionalLight",{position:[3.5,7,5],intensity:1.15,color:"#fff6ea"}),p.jsx("directionalLight",{position:[-5,3,-2],intensity:.35,color:"#e8eef8"}),p.jsxs("group",{scale:1/12,children:[p.jsx("group",{ref:A,position:[0,l.lift,0],children:p.jsx(cn,{r,finish:f,ctx:u,onModel:J=>x({url:v,ok:J})})}),s&&p.jsx(ln,{frame:l,w:r.w,d:i.depthIn,h:i.heightIn})]}),p.jsx(yt,{frames:1,position:[0,-.02,0],scale:Math.max(2,R*2.4),far:Math.max(1,(l.top+4)/12),blur:2.6,opacity:.5,resolution:1024,color:"#3a3127"},`${i.id}:${r.w}:${w?String(m==null?void 0:m.ok):"loading"}`),p.jsx(an,{root:A}),p.jsx(dn,{frame:d,autoRotate:S,onInteract:()=>b(!1)}),p.jsx(mn,{radius:G,onStill:c}),p.jsx(hn,{ready:w,onReady:o},v??i.id),vt&&p.jsx(St,{name:"stage"})]})}function vn({product:i,finishId:e,widthIn:t,autoRotate:s=!0,showDims:n=!1,height:o=360,onReady:c,onStill:r,className:f=""}){var v;const[l,d]=a.useState(!1),u=a.useRef(c);return u.current=c,a.useEffect(()=>d(!1),[i.id,(v=i.model)==null?void 0:v.url]),p.jsx("div",{className:`product-stage ${f}`,style:{height:o},"data-ready":l?"1":void 0,role:"img","aria-label":`3D view of ${i.name}. Drag to turn it; scroll or pinch to zoom.`,children:p.jsx(xt,{frameloop:"demand",dpr:[1,2],gl:{antialias:!0,alpha:!0,preserveDrawingBuffer:!1,powerPreference:"high-performance"},camera:{fov:Se,near:.05,far:100,position:[3,2.5,5]},onCreated:({gl:m})=>{m.toneMapping=Ot,m.toneMappingExposure=1,m.setClearColor(0,0)},children:p.jsx(a.Suspense,{fallback:null,children:p.jsx(pn,{product:i,finishId:e,widthIn:t,showDims:n,autoRotate:s,onStill:r,onReady:()=>{var m;d(!0),(m=u.current)==null||m.call(u)}})})})})}function _n(i){return p.jsx(vn,{...i})}export{vn as StageView,_n as default,on as stageItem};
