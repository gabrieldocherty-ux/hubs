import{r as o,ai as ht,j as v,aj as pt,ak as vt,O as gt,P as he,al as xt,am as yt,an as St,a5 as xe}from"./index-B8UrffP_.js";import{C as wt,Q as bt,O as Mt,a as Et,q as Ut}from"./qaStats-DgJkOULb.js";import{u as z,a as ve,_ as pe,D as _t,V as C,b as Ae,P as Ye,O as Ke,v as Je,I as Dt,F as Te,c as Ee,d as te,W as At,B as Pe,S as et,e as Ue,U as We,f as He,M as tt,g as ne,L as Pt,h as Lt,i as Ct,C as Le,j as Fe,k as jt,l as zt,N as Rt,m as Ot,n as Bt,p as It,s as Tt,G as Wt,o as Ht}from"./models-D1J0EMB6.js";import{R as Ft}from"./RoomEnvironment-CCuptwCT.js";import{s as Nt,f as Gt,d as ye,b as Vt,c as kt,e as $t}from"./stageMath-Npy6Zn5s.js";/* empty css               */import"./index-DqcNQyvT.js";import"./fronts-5BNwTT2r.js";const re=new C,Ce=new C,qt=new C,Ne=new Ae;function Zt(i,e,t){const s=re.setFromMatrixPosition(i.matrixWorld);s.project(e);const n=t.width/2,r=t.height/2;return[s.x*n+n,-(s.y*r)+r]}function Xt(i,e){const t=re.setFromMatrixPosition(i.matrixWorld),s=Ce.setFromMatrixPosition(e.matrixWorld),n=t.sub(s),r=e.getWorldDirection(qt);return n.angleTo(r)>Math.PI/2}function Qt(i,e,t,s){const n=re.setFromMatrixPosition(i.matrixWorld),r=n.clone();r.project(e),Ne.set(r.x,r.y),t.setFromCamera(Ne,e);const c=t.intersectObjects(s,!0);if(c.length){const a=c[0].distance;return n.distanceTo(t.ray.origin)<a}return!0}function Yt(i,e){if(e instanceof Ke)return e.zoom;if(e instanceof Ye){const t=re.setFromMatrixPosition(i.matrixWorld),s=Ce.setFromMatrixPosition(e.matrixWorld),n=e.fov*Math.PI/180,r=t.distanceTo(s);return 1/(2*Math.tan(n/2)*r)}else return 1}function Kt(i,e,t){if(e instanceof Ye||e instanceof Ke){const s=re.setFromMatrixPosition(i.matrixWorld),n=Ce.setFromMatrixPosition(e.matrixWorld),r=s.distanceTo(n),c=(t[1]-t[0])/(e.far-e.near),a=t[1]-c*e.far;return Math.round(c*r+a)}}const _e=i=>Math.abs(i)<1e-10?0:i;function nt(i,e,t=""){let s="matrix3d(";for(let n=0;n!==16;n++)s+=_e(e[n]*i.elements[n])+(n!==15?",":")");return t+s}const Jt=(i=>e=>nt(e,i))([1,-1,1,1,1,-1,1,1,1,-1,1,1,1,-1,1,1]),en=(i=>(e,t)=>nt(e,i(t),"translate(-50%,-50%)"))(i=>[1/i,1/i,1/i,1,-1/i,-1/i,-1/i,-1,1/i,1/i,1/i,1,1,1,1,1]);function tn(i){return i&&typeof i=="object"&&"current"in i}const Se=o.forwardRef(({children:i,eps:e=.001,style:t,className:s,prepend:n,center:r,fullscreen:c,portal:a,distanceFactor:f,sprite:l=!1,transform:u=!1,occlude:d,onOcclude:p,castShadow:m,receiveShadow:S,material:w,geometry:g,zIndexRange:y=[16777271,0],calculatePosition:M=Zt,as:h="div",wrapperClass:x,pointerEvents:N="auto",...E},H)=>{const{gl:G,camera:U,scene:ie,size:L,raycaster:oe,events:ae,viewport:O}=z(),[_]=o.useState(()=>document.createElement(h)),K=o.useRef(),j=o.useRef(null),$=o.useRef(0),q=o.useRef([0,0]),V=o.useRef(null),B=o.useRef(null),J=(a==null?void 0:a.current)||ae.connected||G.domElement.parentNode,k=o.useRef(null),ce=o.useRef(!1),le=o.useMemo(()=>d&&d!=="blending"||Array.isArray(d)&&d.length&&tn(d[0]),[d]);o.useLayoutEffect(()=>{const R=G.domElement;d&&d==="blending"?(R.style.zIndex=`${Math.floor(y[0]/2)}`,R.style.position="absolute",R.style.pointerEvents="none"):(R.style.zIndex=null,R.style.position=null,R.style.pointerEvents=null)},[d]),o.useLayoutEffect(()=>{if(j.current){const R=K.current=ht(_);if(ie.updateMatrixWorld(),u)_.style.cssText="position:absolute;top:0;left:0;pointer-events:none;overflow:hidden;";else{const b=M(j.current,U,L);_.style.cssText=`position:absolute;top:0;left:0;transform:translate3d(${b[0]}px,${b[1]}px,0);transform-origin:0 0;`}return J&&(n?J.prepend(_):J.appendChild(_)),()=>{J&&J.removeChild(_),R.unmount()}}},[J,u]),o.useLayoutEffect(()=>{x&&(_.className=x)},[x]);const Re=o.useMemo(()=>u?{position:"absolute",top:0,left:0,width:L.width,height:L.height,transformStyle:"preserve-3d",pointerEvents:"none"}:{position:"absolute",transform:r?"translate3d(-50%,-50%,0)":"none",...c&&{top:-L.height/2,left:-L.width/2,width:L.width,height:L.height},...t},[t,r,c,L,u]),ot=o.useMemo(()=>({position:"absolute",pointerEvents:N}),[N]);o.useLayoutEffect(()=>{if(ce.current=!1,u){var R;(R=K.current)==null||R.render(o.createElement("div",{ref:V,style:Re},o.createElement("div",{ref:B,style:ot},o.createElement("div",{ref:H,className:s,style:t,children:i}))))}else{var b;(b=K.current)==null||b.render(o.createElement("div",{ref:H,style:Re,className:s,children:i}))}});const ee=o.useRef(!0);ve(R=>{if(j.current){U.updateMatrixWorld(),j.current.updateWorldMatrix(!0,!1);const b=u?q.current:M(j.current,U,L);if(u||Math.abs($.current-U.zoom)>e||Math.abs(q.current[0]-b[0])>e||Math.abs(q.current[1]-b[1])>e){const Z=Xt(j.current,U);let F=!1;le&&(Array.isArray(d)?F=d.map(X=>X.current):d!=="blending"&&(F=[ie]));const se=ee.current;if(F){const X=Qt(j.current,U,oe,F);ee.current=X&&!Z}else ee.current=!Z;se!==ee.current&&(p?p(!ee.current):_.style.display=ee.current?"block":"none");const ue=Math.floor(y[0]/2),at=d?le?[y[0],ue]:[ue-1,0]:y;if(_.style.zIndex=`${Kt(j.current,U,at)}`,u){const[X,Be]=[L.width/2,L.height/2],ge=U.projectionMatrix.elements[5]*Be,{isOrthographicCamera:Ie,top:ct,left:lt,bottom:ut,right:ft}=U,dt=Jt(U.matrixWorldInverse),mt=Ie?`scale(${ge})translate(${_e(-(ft+lt)/2)}px,${_e((ct+ut)/2)}px)`:`translateZ(${ge}px)`;let Q=j.current.matrixWorld;l&&(Q=U.matrixWorldInverse.clone().transpose().copyPosition(Q).scale(j.current.scale),Q.elements[3]=Q.elements[7]=Q.elements[11]=0,Q.elements[15]=1),_.style.width=L.width+"px",_.style.height=L.height+"px",_.style.perspective=Ie?"":`${ge}px`,V.current&&B.current&&(V.current.style.transform=`${mt}${dt}translate(${X}px,${Be}px)`,B.current.style.transform=en(Q,1/((f||10)/400)))}else{const X=f===void 0?1:Yt(j.current,U)*f;_.style.transform=`translate3d(${b[0]}px,${b[1]}px,0) scale(${X})`}q.current=b,$.current=U.zoom}}if(!le&&k.current&&!ce.current)if(u){if(V.current){const b=V.current.children[0];if(b!=null&&b.clientWidth&&b!=null&&b.clientHeight){const{isOrthographicCamera:Z}=U;if(Z||g)E.scale&&(Array.isArray(E.scale)?E.scale instanceof C?k.current.scale.copy(E.scale.clone().divideScalar(1)):k.current.scale.set(1/E.scale[0],1/E.scale[1],1/E.scale[2]):k.current.scale.setScalar(1/E.scale));else{const F=(f||10)/400,se=b.clientWidth*F,ue=b.clientHeight*F;k.current.scale.set(se,ue,1)}ce.current=!0}}}else{const b=_.children[0];if(b!=null&&b.clientWidth&&b!=null&&b.clientHeight){const Z=1/O.factor,F=b.clientWidth*Z,se=b.clientHeight*Z;k.current.scale.set(F,se,1),ce.current=!0}k.current.lookAt(R.camera.position)}});const Oe=o.useMemo(()=>({vertexShader:u?void 0:`
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
      `}),[u]);return o.createElement("group",pe({},E,{ref:j}),d&&!le&&o.createElement("mesh",{castShadow:m,receiveShadow:S,ref:k},g||o.createElement("planeGeometry",null),w||o.createElement("shaderMaterial",{side:_t,vertexShader:Oe.vertexShader,fragmentShader:Oe.fragmentShader})))}),it=Je>=125?"uv1":"uv2",nn={uniforms:{tDiffuse:{value:null},h:{value:1/512}},vertexShader:`
      varying vec2 vUv;

      void main() {

        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

      }
  `,fragmentShader:`
    uniform sampler2D tDiffuse;
    uniform float h;

    varying vec2 vUv;

    void main() {

    	vec4 sum = vec4( 0.0 );

    	sum += texture2D( tDiffuse, vec2( vUv.x - 4.0 * h, vUv.y ) ) * 0.051;
    	sum += texture2D( tDiffuse, vec2( vUv.x - 3.0 * h, vUv.y ) ) * 0.0918;
    	sum += texture2D( tDiffuse, vec2( vUv.x - 2.0 * h, vUv.y ) ) * 0.12245;
    	sum += texture2D( tDiffuse, vec2( vUv.x - 1.0 * h, vUv.y ) ) * 0.1531;
    	sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y ) ) * 0.1633;
    	sum += texture2D( tDiffuse, vec2( vUv.x + 1.0 * h, vUv.y ) ) * 0.1531;
    	sum += texture2D( tDiffuse, vec2( vUv.x + 2.0 * h, vUv.y ) ) * 0.12245;
    	sum += texture2D( tDiffuse, vec2( vUv.x + 3.0 * h, vUv.y ) ) * 0.0918;
    	sum += texture2D( tDiffuse, vec2( vUv.x + 4.0 * h, vUv.y ) ) * 0.051;

    	gl_FragColor = sum;

    }
  `},sn={uniforms:{tDiffuse:{value:null},v:{value:1/512}},vertexShader:`
    varying vec2 vUv;

    void main() {

      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );

    }
  `,fragmentShader:`

  uniform sampler2D tDiffuse;
  uniform float v;

  varying vec2 vUv;

  void main() {

    vec4 sum = vec4( 0.0 );

    sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y - 4.0 * v ) ) * 0.051;
    sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y - 3.0 * v ) ) * 0.0918;
    sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y - 2.0 * v ) ) * 0.12245;
    sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y - 1.0 * v ) ) * 0.1531;
    sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y ) ) * 0.1633;
    sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y + 1.0 * v ) ) * 0.1531;
    sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y + 2.0 * v ) ) * 0.12245;
    sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y + 3.0 * v ) ) * 0.0918;
    sum += texture2D( tDiffuse, vec2( vUv.x, vUv.y + 4.0 * v ) ) * 0.051;

    gl_FragColor = sum;

  }
  `},Ge=new Pe,fe=new C;class je extends Dt{constructor(){super(),this.isLineSegmentsGeometry=!0,this.type="LineSegmentsGeometry";const e=[-1,2,0,1,2,0,-1,1,0,1,1,0,-1,0,0,1,0,0,-1,-1,0,1,-1,0],t=[-1,2,1,2,-1,1,1,1,-1,-1,1,-1,-1,-2,1,-2],s=[0,2,1,2,3,1,2,4,3,4,5,3,4,6,5,6,7,5];this.setIndex(s),this.setAttribute("position",new Te(e,3)),this.setAttribute("uv",new Te(t,2))}applyMatrix4(e){const t=this.attributes.instanceStart,s=this.attributes.instanceEnd;return t!==void 0&&(t.applyMatrix4(e),s.applyMatrix4(e),t.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this}setPositions(e){let t;e instanceof Float32Array?t=e:Array.isArray(e)&&(t=new Float32Array(e));const s=new Ee(t,6,1);return this.setAttribute("instanceStart",new te(s,3,0)),this.setAttribute("instanceEnd",new te(s,3,3)),this.computeBoundingBox(),this.computeBoundingSphere(),this}setColors(e,t=3){let s;e instanceof Float32Array?s=e:Array.isArray(e)&&(s=new Float32Array(e));const n=new Ee(s,t*2,1);return this.setAttribute("instanceColorStart",new te(n,t,0)),this.setAttribute("instanceColorEnd",new te(n,t,t)),this}fromWireframeGeometry(e){return this.setPositions(e.attributes.position.array),this}fromEdgesGeometry(e){return this.setPositions(e.attributes.position.array),this}fromMesh(e){return this.fromWireframeGeometry(new At(e.geometry)),this}fromLineSegments(e){const t=e.geometry;return this.setPositions(t.attributes.position.array),this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new Pe);const e=this.attributes.instanceStart,t=this.attributes.instanceEnd;e!==void 0&&t!==void 0&&(this.boundingBox.setFromBufferAttribute(e),Ge.setFromBufferAttribute(t),this.boundingBox.union(Ge))}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new et),this.boundingBox===null&&this.computeBoundingBox();const e=this.attributes.instanceStart,t=this.attributes.instanceEnd;if(e!==void 0&&t!==void 0){const s=this.boundingSphere.center;this.boundingBox.getCenter(s);let n=0;for(let r=0,c=e.count;r<c;r++)fe.fromBufferAttribute(e,r),n=Math.max(n,s.distanceToSquared(fe)),fe.fromBufferAttribute(t,r),n=Math.max(n,s.distanceToSquared(fe));this.boundingSphere.radius=Math.sqrt(n),isNaN(this.boundingSphere.radius)&&console.error("THREE.LineSegmentsGeometry.computeBoundingSphere(): Computed radius is NaN. The instanced position data is likely to have NaN values.",this)}}toJSON(){}applyMatrix(e){return console.warn("THREE.LineSegmentsGeometry: applyMatrix() has been renamed to applyMatrix4()."),this.applyMatrix4(e)}}class st extends je{constructor(){super(),this.isLineGeometry=!0,this.type="LineGeometry"}setPositions(e){const t=e.length-3,s=new Float32Array(2*t);for(let n=0;n<t;n+=3)s[2*n]=e[n],s[2*n+1]=e[n+1],s[2*n+2]=e[n+2],s[2*n+3]=e[n+3],s[2*n+4]=e[n+4],s[2*n+5]=e[n+5];return super.setPositions(s),this}setColors(e,t=3){const s=e.length-t,n=new Float32Array(2*s);if(t===3)for(let r=0;r<s;r+=t)n[2*r]=e[r],n[2*r+1]=e[r+1],n[2*r+2]=e[r+2],n[2*r+3]=e[r+3],n[2*r+4]=e[r+4],n[2*r+5]=e[r+5];else for(let r=0;r<s;r+=t)n[2*r]=e[r],n[2*r+1]=e[r+1],n[2*r+2]=e[r+2],n[2*r+3]=e[r+3],n[2*r+4]=e[r+4],n[2*r+5]=e[r+5],n[2*r+6]=e[r+6],n[2*r+7]=e[r+7];return super.setColors(n,t),this}fromLine(e){const t=e.geometry;return this.setPositions(t.attributes.position.array),this}}class ze extends Ue{constructor(e){super({type:"LineMaterial",uniforms:We.clone(We.merge([He.common,He.fog,{worldUnits:{value:1},linewidth:{value:1},resolution:{value:new Ae(1,1)},dashOffset:{value:0},dashScale:{value:1},dashSize:{value:1},gapSize:{value:1}}])),vertexShader:`
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
					#include <${Je>=154?"colorspace_fragment":"encodings_fragment"}>
					#include <fog_fragment>
					#include <premultiplied_alpha_fragment>

				}
			`,clipping:!0}),this.isLineMaterial=!0,this.onBeforeCompile=function(){this.transparent?this.defines.USE_LINE_COLOR_ALPHA="1":delete this.defines.USE_LINE_COLOR_ALPHA},Object.defineProperties(this,{color:{enumerable:!0,get:function(){return this.uniforms.diffuse.value},set:function(t){this.uniforms.diffuse.value=t}},worldUnits:{enumerable:!0,get:function(){return"WORLD_UNITS"in this.defines},set:function(t){t===!0?this.defines.WORLD_UNITS="":delete this.defines.WORLD_UNITS}},linewidth:{enumerable:!0,get:function(){return this.uniforms.linewidth.value},set:function(t){this.uniforms.linewidth.value=t}},dashed:{enumerable:!0,get:function(){return"USE_DASH"in this.defines},set(t){!!t!="USE_DASH"in this.defines&&(this.needsUpdate=!0),t===!0?this.defines.USE_DASH="":delete this.defines.USE_DASH}},dashScale:{enumerable:!0,get:function(){return this.uniforms.dashScale.value},set:function(t){this.uniforms.dashScale.value=t}},dashSize:{enumerable:!0,get:function(){return this.uniforms.dashSize.value},set:function(t){this.uniforms.dashSize.value=t}},dashOffset:{enumerable:!0,get:function(){return this.uniforms.dashOffset.value},set:function(t){this.uniforms.dashOffset.value=t}},gapSize:{enumerable:!0,get:function(){return this.uniforms.gapSize.value},set:function(t){this.uniforms.gapSize.value=t}},opacity:{enumerable:!0,get:function(){return this.uniforms.opacity.value},set:function(t){this.uniforms.opacity.value=t}},resolution:{enumerable:!0,get:function(){return this.uniforms.resolution.value},set:function(t){this.uniforms.resolution.value.copy(t)}},alphaToCoverage:{enumerable:!0,get:function(){return"USE_ALPHA_TO_COVERAGE"in this.defines},set:function(t){!!t!="USE_ALPHA_TO_COVERAGE"in this.defines&&(this.needsUpdate=!0),t===!0?(this.defines.USE_ALPHA_TO_COVERAGE="",this.extensions.derivatives=!0):(delete this.defines.USE_ALPHA_TO_COVERAGE,this.extensions.derivatives=!1)}}}),this.setValues(e)}}const we=new ne,Ve=new C,ke=new C,D=new ne,A=new ne,I=new ne,be=new C,Me=new Lt,P=new Pt,$e=new C,de=new Pe,me=new et,T=new ne;let W,Y;function qe(i,e,t){return T.set(0,0,-e,1).applyMatrix4(i.projectionMatrix),T.multiplyScalar(1/T.w),T.x=Y/t.width,T.y=Y/t.height,T.applyMatrix4(i.projectionMatrixInverse),T.multiplyScalar(1/T.w),Math.abs(Math.max(T.x,T.y))}function rn(i,e){const t=i.matrixWorld,s=i.geometry,n=s.attributes.instanceStart,r=s.attributes.instanceEnd,c=Math.min(s.instanceCount,n.count);for(let a=0,f=c;a<f;a++){P.start.fromBufferAttribute(n,a),P.end.fromBufferAttribute(r,a),P.applyMatrix4(t);const l=new C,u=new C;W.distanceSqToSegment(P.start,P.end,u,l),u.distanceTo(l)<Y*.5&&e.push({point:u,pointOnLine:l,distance:W.origin.distanceTo(u),object:i,face:null,faceIndex:a,uv:null,[it]:null})}}function on(i,e,t){const s=e.projectionMatrix,r=i.material.resolution,c=i.matrixWorld,a=i.geometry,f=a.attributes.instanceStart,l=a.attributes.instanceEnd,u=Math.min(a.instanceCount,f.count),d=-e.near;W.at(1,I),I.w=1,I.applyMatrix4(e.matrixWorldInverse),I.applyMatrix4(s),I.multiplyScalar(1/I.w),I.x*=r.x/2,I.y*=r.y/2,I.z=0,be.copy(I),Me.multiplyMatrices(e.matrixWorldInverse,c);for(let p=0,m=u;p<m;p++){if(D.fromBufferAttribute(f,p),A.fromBufferAttribute(l,p),D.w=1,A.w=1,D.applyMatrix4(Me),A.applyMatrix4(Me),D.z>d&&A.z>d)continue;if(D.z>d){const h=D.z-A.z,x=(D.z-d)/h;D.lerp(A,x)}else if(A.z>d){const h=A.z-D.z,x=(A.z-d)/h;A.lerp(D,x)}D.applyMatrix4(s),A.applyMatrix4(s),D.multiplyScalar(1/D.w),A.multiplyScalar(1/A.w),D.x*=r.x/2,D.y*=r.y/2,A.x*=r.x/2,A.y*=r.y/2,P.start.copy(D),P.start.z=0,P.end.copy(A),P.end.z=0;const w=P.closestPointToPointParameter(be,!0);P.at(w,$e);const g=Ct.lerp(D.z,A.z,w),y=g>=-1&&g<=1,M=be.distanceTo($e)<Y*.5;if(y&&M){P.start.fromBufferAttribute(f,p),P.end.fromBufferAttribute(l,p),P.start.applyMatrix4(c),P.end.applyMatrix4(c);const h=new C,x=new C;W.distanceSqToSegment(P.start,P.end,x,h),t.push({point:x,pointOnLine:h,distance:W.origin.distanceTo(x),object:i,face:null,faceIndex:p,uv:null,[it]:null})}}}class rt extends tt{constructor(e=new je,t=new ze({color:Math.random()*16777215})){super(e,t),this.isLineSegments2=!0,this.type="LineSegments2"}computeLineDistances(){const e=this.geometry,t=e.attributes.instanceStart,s=e.attributes.instanceEnd,n=new Float32Array(2*t.count);for(let c=0,a=0,f=t.count;c<f;c++,a+=2)Ve.fromBufferAttribute(t,c),ke.fromBufferAttribute(s,c),n[a]=a===0?0:n[a-1],n[a+1]=n[a]+Ve.distanceTo(ke);const r=new Ee(n,2,1);return e.setAttribute("instanceDistanceStart",new te(r,1,0)),e.setAttribute("instanceDistanceEnd",new te(r,1,1)),this}raycast(e,t){const s=this.material.worldUnits,n=e.camera;n===null&&!s&&console.error('LineSegments2: "Raycaster.camera" needs to be set in order to raycast against LineSegments2 while worldUnits is set to false.');const r=e.params.Line2!==void 0&&e.params.Line2.threshold||0;W=e.ray;const c=this.matrixWorld,a=this.geometry,f=this.material;Y=f.linewidth+r,a.boundingSphere===null&&a.computeBoundingSphere(),me.copy(a.boundingSphere).applyMatrix4(c);let l;if(s)l=Y*.5;else{const d=Math.max(n.near,me.distanceToPoint(W.origin));l=qe(n,d,f.resolution)}if(me.radius+=l,W.intersectsSphere(me)===!1)return;a.boundingBox===null&&a.computeBoundingBox(),de.copy(a.boundingBox).applyMatrix4(c);let u;if(s)u=Y*.5;else{const d=Math.max(n.near,de.distanceToPoint(W.origin));u=qe(n,d,f.resolution)}de.expandByScalar(u),W.intersectsBox(de)!==!1&&(s?rn(this,t):on(this,n,t))}onBeforeRender(e){const t=this.material.uniforms;t&&t.resolution&&(e.getViewport(we),this.material.uniforms.resolution.value.set(we.z,we.w))}}class an extends rt{constructor(e=new st,t=new ze({color:Math.random()*16777215})){super(e,t),this.isLine2=!0,this.type="Line2"}}const cn=o.forwardRef(function({points:e,color:t=16777215,vertexColors:s,linewidth:n,lineWidth:r,segments:c,dashed:a,...f},l){var u,d;const p=z(y=>y.size),m=o.useMemo(()=>c?new rt:new an,[c]),[S]=o.useState(()=>new ze),w=(s==null||(u=s[0])==null?void 0:u.length)===4?4:3,g=o.useMemo(()=>{const y=c?new je:new st,M=e.map(h=>{const x=Array.isArray(h);return h instanceof C||h instanceof ne?[h.x,h.y,h.z]:h instanceof Ae?[h.x,h.y,0]:x&&h.length===3?[h[0],h[1],h[2]]:x&&h.length===2?[h[0],h[1],0]:h});if(y.setPositions(M.flat()),s){t=16777215;const h=s.map(x=>x instanceof Le?x.toArray():x);y.setColors(h.flat(),w)}return y},[e,c,s,w]);return o.useLayoutEffect(()=>{m.computeLineDistances()},[e,m]),o.useLayoutEffect(()=>{a?S.defines.USE_DASH="":delete S.defines.USE_DASH,S.needsUpdate=!0},[a,S]),o.useEffect(()=>()=>{g.dispose(),S.dispose()},[g]),o.createElement("primitive",pe({object:m,ref:l},f),o.createElement("primitive",{object:g,attach:"geometry"}),o.createElement("primitive",pe({object:S,attach:"material",color:t,vertexColors:!!s,resolution:[p.width,p.height],linewidth:(d=n??r)!==null&&d!==void 0?d:1,dashed:a,transparent:w===4},f)))}),ln=o.forwardRef(({scale:i=10,frames:e=1/0,opacity:t=1,width:s=1,height:n=1,blur:r=1,near:c=0,far:a=10,resolution:f=512,smooth:l=!0,color:u="#000000",depthWrite:d=!1,renderOrder:p,...m},S)=>{const w=o.useRef(null),g=z(O=>O.scene),y=z(O=>O.gl),M=o.useRef(null);s=s*(Array.isArray(i)?i[0]:i||1),n=n*(Array.isArray(i)?i[1]:i||1);const[h,x,N,E,H,G,U]=o.useMemo(()=>{const O=new Fe(f,f),_=new Fe(f,f);_.texture.generateMipmaps=O.texture.generateMipmaps=!1;const K=new jt(s,n).rotateX(Math.PI/2),j=new tt(K),$=new zt;$.depthTest=$.depthWrite=!1,$.onBeforeCompile=B=>{B.uniforms={...B.uniforms,ucolor:{value:new Le(u)}},B.fragmentShader=B.fragmentShader.replace("void main() {",`uniform vec3 ucolor;
           void main() {
          `),B.fragmentShader=B.fragmentShader.replace("vec4( vec3( 1.0 - fragCoordZ ), opacity );","vec4( ucolor * fragCoordZ * 2.0, ( 1.0 - fragCoordZ ) * 1.0 );")};const q=new Ue(nn),V=new Ue(sn);return V.depthTest=q.depthTest=!1,[O,K,$,j,q,V,_]},[f,s,n,i,u]),ie=O=>{E.visible=!0,E.material=H,H.uniforms.tDiffuse.value=h.texture,H.uniforms.h.value=O*1/256,y.setRenderTarget(U),y.render(E,M.current),E.material=G,G.uniforms.tDiffuse.value=U.texture,G.uniforms.v.value=O*1/256,y.setRenderTarget(h),y.render(E,M.current),E.visible=!1};let L=0,oe,ae;return ve(()=>{M.current&&(e===1/0||L<e)&&(L++,oe=g.background,ae=g.overrideMaterial,w.current.visible=!1,g.background=null,g.overrideMaterial=N,y.setRenderTarget(h),y.render(g,M.current),ie(r),l&&ie(r*.4),y.setRenderTarget(null),w.current.visible=!0,g.overrideMaterial=ae,g.background=oe)}),o.useImperativeHandle(S,()=>w.current,[]),o.createElement("group",pe({"rotation-x":Math.PI/2},m,{ref:w}),o.createElement("mesh",{renderOrder:p,geometry:x,scale:[1,-1,1],rotation:[-Math.PI/2,0,0]},o.createElement("meshBasicMaterial",{transparent:!0,map:h.texture,opacity:t,depthWrite:d})),o.createElement("orthographicCamera",{ref:M,args:[-s/2,s/2,n/2,-n/2,c,a]}))}),De=30,Ze=1,Xe={inner:"#fbf9f5",outer:"#e8e1d5"};function un(i,e,t){const s=t??i.widthIn,n=i.depthIn,r=e?pt(i,e):vt(i,gt(i,he)),c={id:"stage",productId:i.id,x:0,y:0,rotation:0,...r,widthIn:s};return{r:{item:c,product:i,w:s,d:n,box:{minX:-s/2,minY:-n/2,maxX:s/2,maxY:n/2},z0:i.elevationIn,z1:i.elevationIn+i.heightIn},finish:xt(c,i,he)}}function Qe(){try{return matchMedia("(prefers-reduced-motion: reduce)").matches}catch{return!1}}function fn(){const i=z(s=>s.gl),e=z(s=>s.scene),t=z(s=>s.invalidate);return o.useLayoutEffect(()=>{const s=new Bt(i),n=new Ft,r=s.fromScene(n,.04);return n.dispose(),s.dispose(),e.environment=r.texture,t(),()=>{e.environment===r.texture&&(e.environment=null),r.dispose()}},[i,e,t]),null}function dn({root:i}){const e=o.useMemo(()=>new Map,[]);return o.useEffect(()=>()=>{e.forEach(t=>t.dispose()),e.clear()},[e]),ve(()=>{var t;(t=i.current)==null||t.traverse(s=>{const n=s;if(!n.isMesh||Array.isArray(n.material))return;const r=n.material;if(!(r!=null&&r.isMeshPhysicalMaterial)||!r.transparent||r.transmission>0||r.opacity>=.97)return;let c=e.get(r);c||(c=new Ht({color:r.color.clone().lerp(new Le("#ffffff"),r.opacity<.5?.6:0),roughness:Math.min(r.roughness,.06),metalness:0,transmission:1,thickness:.25,ior:1.5,clearcoat:1,clearcoatRoughness:.03,side:r.side}),e.set(r,c)),n.material=c})},-2),null}function mn({r:i,finish:e,ctx:t,onModel:s}){var l;const{product:n}=i,r=n.source!=="missing"?(l=n.model)==null?void 0:l.url:void 0,c=St(n)?v.jsx(Mt,{r:i,surfaces:he,ctx:t,bare:!0}):It({r:i,finish:e,ctx:t}),a=o.useMemo(()=>({w:i.w,h:n.heightIn,d:n.depthIn}),[i.w,n.heightIn,n.depthIn]),f=o.useMemo(()=>Tt(e,t),[e.id,e.hex,e.material,t]);return o.useEffect(()=>{r||s(!0)},[r]),r?v.jsx("group",{position:[0,n.elevationIn,0],children:v.jsx(Wt,{url:r,target:a,slots:f,onReady:s,fallback:v.jsx("group",{position:[0,-n.elevationIn,0],children:c})})}):c}function hn({frame:i,w:e,d:t,h:s}){const n=o.useRef(null),r=z(x=>x.camera),c=z(x=>x.invalidate),{off:a,tick:f}=kt(e,t),l=i.bottom+.3,u=-e/2,d=e/2,p=-t/2,m=t/2,S=m+a,w=d+a,g=u-a,y=i.bottom,M=i.bottom+s,h=o.useMemo(()=>[[u,l,S],[d,l,S],[u,l,S-f],[u,l,S+f],[d,l,S-f],[d,l,S+f],[w,l,p],[w,l,m],[w-f,l,p],[w+f,l,p],[w-f,l,m],[w+f,l,m],[g,y,m],[g,M,m],[g-f,y,m],[g+f,y,m],[g-f,M,m],[g+f,M,m]],[u,d,p,m,S,w,g,l,y,M,f]);return o.useEffect(()=>{var x;r.layers.enable(Ze),(x=n.current)==null||x.traverse(N=>N.layers.set(Ze)),c()},[r,c,h]),v.jsxs("group",{ref:n,name:"stage-dims",children:[v.jsx(cn,{points:h,segments:!0,color:"#c2542d",lineWidth:1.6,depthTest:!1,renderOrder:10}),v.jsxs(Se,{position:[0,l,S+f*1.6],center:!0,className:"stage-dim",zIndexRange:[5,0],children:[v.jsx("b",{children:"W"})," ",ye(e,xe)]}),v.jsxs(Se,{position:[w+f*1.6,l,0],center:!0,className:"stage-dim",zIndexRange:[5,0],children:[v.jsx("b",{children:"D"})," ",ye(t,xe)]}),v.jsxs(Se,{position:[g-f*1.6,(y+M)/2,m],center:!0,className:"stage-dim",zIndexRange:[5,0],children:[v.jsx("b",{children:"H"})," ",ye(s,xe)]})]})}function pn({frame:i,autoRotate:e,onInteract:t}){const s=o.useRef(null),n=z(u=>u.camera),r=z(u=>u.size),c=z(u=>u.invalidate),a=r.width/Math.max(1,r.height),f=Math.round(a*20),l=o.useMemo(()=>Vt(i,De,f/20),[i,f]);return o.useLayoutEffect(()=>{n.fov=De,n.near=Math.max(.02,l.radius/50),n.far=l.distance*8+10,n.position.set(...l.position),n.updateProjectionMatrix();const u=s.current;u&&(u.target.set(...l.target),u.update()),c()},[l,n,c]),v.jsx(Et,{ref:s,makeDefault:!0,enablePan:!1,enableDamping:!0,dampingFactor:.09,autoRotate:e,autoRotateSpeed:1.1,minDistance:l.minDistance,maxDistance:l.maxDistance,minPolarAngle:.12,maxPolarAngle:Math.PI/2-.03,onStart:t})}function vn(i,e,t){const s=i.createRadialGradient(e/2,t*.42,0,e/2,t*.42,Math.max(e,t)*.75);s.addColorStop(0,Xe.inner),s.addColorStop(1,Xe.outer),i.fillStyle=s,i.fillRect(0,0,e,t)}function gn(i,e,t){const s=i(),{gl:n,scene:r,invalidate:c}=s,a=s.camera,f=s.controls,l=(f==null?void 0:f.target.clone())??new C,u=r.getObjectByName("stage-dims"),d=Math.min(4096,n.capabilities.maxTextureSize),p=Math.max(64,Math.min(Math.round(t),d)),m={pos:a.position.clone(),quat:a.quaternion.clone(),aspect:a.aspect,pr:n.getPixelRatio(),dims:(u==null?void 0:u.visible)??!1},S=document.createElement("canvas");S.width=S.height=p;try{u&&(u.visible=!1);const w=a.position.clone().sub(l).normalize();a.aspect=1,a.position.copy(l).addScaledVector(w,$t(e,a.fov,1,1.02)),a.lookAt(l),a.updateProjectionMatrix(),a.updateMatrixWorld(),n.setPixelRatio(1),n.setSize(p,p,!1),n.render(r,a);const g=S.getContext("2d");if(!g)throw new Error("This browser can’t make the image.");vn(g,p,p),g.drawImage(n.domElement,0,0,p,p)}finally{u&&(u.visible=m.dims),a.position.copy(m.pos),a.quaternion.copy(m.quat),a.aspect=m.aspect,a.updateProjectionMatrix(),a.updateMatrixWorld(),n.setPixelRatio(m.pr),n.setSize(s.size.width,s.size.height,!1),c()}return S}function xn({radius:i,onStill:e}){const t=z(n=>n.get),s=o.useRef(i);return s.current=i,o.useEffect(()=>{const n=async r=>gn(t,s.current,r);return e==null||e(n),Ut({stage:{get:t,renderStill:async r=>{const c=await n(r);return{width:c.width,height:c.height}}}}),()=>e==null?void 0:e(null)},[t,e]),null}function yn({ready:i,onReady:e}){const t=o.useRef(!1),s=z(n=>n.invalidate);return o.useEffect(()=>{i&&s()},[i,s]),ve(()=>{!i||t.current||(t.current=!0,requestAnimationFrame(()=>e()))}),null}function Sn({product:i,finishId:e,widthIn:t,showDims:s,autoRotate:n,onReady:r,onStill:c}){var H;const{r:a,finish:f}=o.useMemo(()=>un(i,e,t),[i,e,t]),l=o.useMemo(()=>Nt({w:a.w,d:i.depthIn,h:i.heightIn,elevationIn:i.elevationIn,kind:i.kind}),[a.w,i.depthIn,i.heightIn,i.elevationIn,i.kind]),u=o.useMemo(()=>Gt(l,a.w,i.depthIn),[l,a.w,i.depthIn]),d=o.useMemo(()=>Ot(he,{ceilingIn:l.ceilingIn}),[l.ceilingIn]),p=i.source!=="missing"&&((H=i.model)==null?void 0:H.url)||null,[m,S]=o.useState(null),w=m!==null&&m.url===p,[g,y]=o.useState(()=>n&&!Qe()),M=o.useRef(null),{min:h,max:x}=l.box,N=Math.hypot(x[0]-h[0],x[1]-h[1],x[2]-h[2])/24,E=Math.max(a.w,i.depthIn)/12;return o.useEffect(()=>y(n&&!Qe()),[n]),v.jsxs(v.Fragment,{children:[v.jsx(fn,{}),v.jsx("ambientLight",{intensity:.12}),v.jsx("directionalLight",{position:[3.5,7,5],intensity:1.15,color:"#fff6ea"}),v.jsx("directionalLight",{position:[-5,3,-2],intensity:.35,color:"#e8eef8"}),v.jsxs("group",{scale:1/12,children:[v.jsx("group",{ref:M,position:[0,l.lift,0],children:v.jsx(mn,{r:a,finish:f,ctx:d,onModel:G=>S({url:p,ok:G})})}),s&&v.jsx(hn,{frame:l,w:a.w,d:i.depthIn,h:i.heightIn})]}),v.jsx(ln,{frames:1,position:[0,-.02,0],scale:Math.max(2,E*2.4),far:Math.max(1,(l.top+4)/12),blur:2.6,opacity:.5,resolution:1024,color:"#3a3127"},`${i.id}:${a.w}:${w?String(m==null?void 0:m.ok):"loading"}`),v.jsx(dn,{root:M}),v.jsx(pn,{frame:u,autoRotate:g,onInteract:()=>y(!1)}),v.jsx(xn,{radius:N,onStill:c}),v.jsx(yn,{ready:w,onReady:r},p??i.id),yt&&v.jsx(bt,{name:"stage"})]})}function wn({product:i,finishId:e,widthIn:t,autoRotate:s=!0,showDims:n=!1,height:r=360,onReady:c,onStill:a,className:f=""}){var p;const[l,u]=o.useState(!1),d=o.useRef(c);return d.current=c,o.useEffect(()=>u(!1),[i.id,(p=i.model)==null?void 0:p.url]),v.jsx("div",{className:`product-stage ${f}`,style:{height:r},"data-ready":l?"1":void 0,role:"img","aria-label":`3D view of ${i.name}. Drag to turn it; scroll or pinch to zoom.`,children:v.jsx(wt,{frameloop:"demand",dpr:[1,2],gl:{antialias:!0,alpha:!0,preserveDrawingBuffer:!1,powerPreference:"high-performance"},camera:{fov:De,near:.05,far:100,position:[3,2.5,5]},onCreated:({gl:m})=>{m.toneMapping=Rt,m.toneMappingExposure=1,m.setClearColor(0,0)},children:v.jsx(o.Suspense,{fallback:null,children:v.jsx(Sn,{product:i,finishId:e,widthIn:t,showDims:n,autoRotate:s,onStill:a,onReady:()=>{var m;u(!0),(m=d.current)==null||m.call(d)}})})})})}function Ln(i){return v.jsx(wn,{...i})}export{wn as StageView,Ln as default,un as stageItem};
