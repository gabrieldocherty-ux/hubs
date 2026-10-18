import{r as a,ai as vt,j as g,aj as gt,ak as xt,O as yt,P as ve,al as wt,am as St,an as bt,a5 as we}from"./index-z7-8GRn1.js";import{u as B,a as xe,_ as ge,D as Mt,V as z,b as Le,P as et,O as tt,v as nt,I as Et,F as He,c as _e,d as ie,W as Ut,B as Ce,S as it,e as De,U as Fe,f as Ne,M as C,g as se,L as _t,h as Dt,i as At,C as ze,j as Ge,k as Pt,l as Lt,m as Ct,n as zt,o as Ve,p as jt,q as Bt,r as Rt,s as Ot,N as It,t as Tt,Q as Wt,w as Ht,x as Ft,y as Nt,z as Gt,G as Vt,A as kt,E as $t,H as qt}from"./qaStats-CJwm8ILb.js";import{s as Zt,f as Xt,d as Se,b as Qt,c as Yt,e as Kt}from"./stageMath-Npy6Zn5s.js";/* empty css               */import"./textures-68nJB-Np.js";import"./fronts-CSyzaH0T.js";const ae=new z,je=new z,Jt=new z,ke=new Le;function en(i,e,t){const s=ae.setFromMatrixPosition(i.matrixWorld);s.project(e);const n=t.width/2,o=t.height/2;return[s.x*n+n,-(s.y*o)+o]}function tn(i,e){const t=ae.setFromMatrixPosition(i.matrixWorld),s=je.setFromMatrixPosition(e.matrixWorld),n=t.sub(s),o=e.getWorldDirection(Jt);return n.angleTo(o)>Math.PI/2}function nn(i,e,t,s){const n=ae.setFromMatrixPosition(i.matrixWorld),o=n.clone();o.project(e),ke.set(o.x,o.y),t.setFromCamera(ke,e);const c=t.intersectObjects(s,!0);if(c.length){const r=c[0].distance;return n.distanceTo(t.ray.origin)<r}return!0}function sn(i,e){if(e instanceof tt)return e.zoom;if(e instanceof et){const t=ae.setFromMatrixPosition(i.matrixWorld),s=je.setFromMatrixPosition(e.matrixWorld),n=e.fov*Math.PI/180,o=t.distanceTo(s);return 1/(2*Math.tan(n/2)*o)}else return 1}function on(i,e,t){if(e instanceof et||e instanceof tt){const s=ae.setFromMatrixPosition(i.matrixWorld),n=je.setFromMatrixPosition(e.matrixWorld),o=s.distanceTo(n),c=(t[1]-t[0])/(e.far-e.near),r=t[1]-c*e.far;return Math.round(c*o+r)}}const Ae=i=>Math.abs(i)<1e-10?0:i;function st(i,e,t=""){let s="matrix3d(";for(let n=0;n!==16;n++)s+=Ae(e[n]*i.elements[n])+(n!==15?",":")");return t+s}const rn=(i=>e=>st(e,i))([1,-1,1,1,1,-1,1,1,1,-1,1,1,1,-1,1,1]),an=(i=>(e,t)=>st(e,i(t),"translate(-50%,-50%)"))(i=>[1/i,1/i,1/i,1,-1/i,-1/i,-1/i,-1,1/i,1/i,1/i,1,1,1,1,1]);function cn(i){return i&&typeof i=="object"&&"current"in i}const be=a.forwardRef(({children:i,eps:e=.001,style:t,className:s,prepend:n,center:o,fullscreen:c,portal:r,distanceFactor:d,sprite:l=!1,transform:u=!1,occlude:f,onOcclude:p,castShadow:m,receiveShadow:y,material:w,geometry:v,zIndexRange:x=[16777271,0],calculatePosition:M=en,as:h="div",wrapperClass:S,pointerEvents:G="auto",...E},F)=>{const{gl:V,camera:U,scene:oe,size:L,raycaster:ce,events:le,viewport:O}=B(),[_]=a.useState(()=>document.createElement(h)),J=a.useRef(),j=a.useRef(null),q=a.useRef(0),Z=a.useRef([0,0]),k=a.useRef(null),I=a.useRef(null),ee=(r==null?void 0:r.current)||le.connected||V.domElement.parentNode,$=a.useRef(null),ue=a.useRef(!1),de=a.useMemo(()=>f&&f!=="blending"||Array.isArray(f)&&f.length&&cn(f[0]),[f]);a.useLayoutEffect(()=>{const R=V.domElement;f&&f==="blending"?(R.style.zIndex=`${Math.floor(x[0]/2)}`,R.style.position="absolute",R.style.pointerEvents="none"):(R.style.zIndex=null,R.style.position=null,R.style.pointerEvents=null)},[f]),a.useLayoutEffect(()=>{if(j.current){const R=J.current=vt(_);if(oe.updateMatrixWorld(),u)_.style.cssText="position:absolute;top:0;left:0;pointer-events:none;overflow:hidden;";else{const b=M(j.current,U,L);_.style.cssText=`position:absolute;top:0;left:0;transform:translate3d(${b[0]}px,${b[1]}px,0);transform-origin:0 0;`}return ee&&(n?ee.prepend(_):ee.appendChild(_)),()=>{ee&&ee.removeChild(_),R.unmount()}}},[ee,u]),a.useLayoutEffect(()=>{S&&(_.className=S)},[S]);const Oe=a.useMemo(()=>u?{position:"absolute",top:0,left:0,width:L.width,height:L.height,transformStyle:"preserve-3d",pointerEvents:"none"}:{position:"absolute",transform:o?"translate3d(-50%,-50%,0)":"none",...c&&{top:-L.height/2,left:-L.width/2,width:L.width,height:L.height},...t},[t,o,c,L,u]),ct=a.useMemo(()=>({position:"absolute",pointerEvents:G}),[G]);a.useLayoutEffect(()=>{if(ue.current=!1,u){var R;(R=J.current)==null||R.render(a.createElement("div",{ref:k,style:Oe},a.createElement("div",{ref:I,style:ct},a.createElement("div",{ref:F,className:s,style:t,children:i}))))}else{var b;(b=J.current)==null||b.render(a.createElement("div",{ref:F,style:Oe,className:s,children:i}))}});const te=a.useRef(!0);xe(R=>{if(j.current){U.updateMatrixWorld(),j.current.updateWorldMatrix(!0,!1);const b=u?Z.current:M(j.current,U,L);if(u||Math.abs(q.current-U.zoom)>e||Math.abs(Z.current[0]-b[0])>e||Math.abs(Z.current[1]-b[1])>e){const X=tn(j.current,U);let N=!1;de&&(Array.isArray(f)?N=f.map(Q=>Q.current):f!=="blending"&&(N=[oe]));const re=te.current;if(N){const Q=nn(j.current,U,ce,N);te.current=Q&&!X}else te.current=!X;re!==te.current&&(p?p(!te.current):_.style.display=te.current?"block":"none");const fe=Math.floor(x[0]/2),lt=f?de?[x[0],fe]:[fe-1,0]:x;if(_.style.zIndex=`${on(j.current,U,lt)}`,u){const[Q,Te]=[L.width/2,L.height/2],ye=U.projectionMatrix.elements[5]*Te,{isOrthographicCamera:We,top:ut,left:dt,bottom:ft,right:mt}=U,ht=rn(U.matrixWorldInverse),pt=We?`scale(${ye})translate(${Ae(-(mt+dt)/2)}px,${Ae((ut+ft)/2)}px)`:`translateZ(${ye}px)`;let Y=j.current.matrixWorld;l&&(Y=U.matrixWorldInverse.clone().transpose().copyPosition(Y).scale(j.current.scale),Y.elements[3]=Y.elements[7]=Y.elements[11]=0,Y.elements[15]=1),_.style.width=L.width+"px",_.style.height=L.height+"px",_.style.perspective=We?"":`${ye}px`,k.current&&I.current&&(k.current.style.transform=`${pt}${ht}translate(${Q}px,${Te}px)`,I.current.style.transform=an(Y,1/((d||10)/400)))}else{const Q=d===void 0?1:sn(j.current,U)*d;_.style.transform=`translate3d(${b[0]}px,${b[1]}px,0) scale(${Q})`}Z.current=b,q.current=U.zoom}}if(!de&&$.current&&!ue.current)if(u){if(k.current){const b=k.current.children[0];if(b!=null&&b.clientWidth&&b!=null&&b.clientHeight){const{isOrthographicCamera:X}=U;if(X||v)E.scale&&(Array.isArray(E.scale)?E.scale instanceof z?$.current.scale.copy(E.scale.clone().divideScalar(1)):$.current.scale.set(1/E.scale[0],1/E.scale[1],1/E.scale[2]):$.current.scale.setScalar(1/E.scale));else{const N=(d||10)/400,re=b.clientWidth*N,fe=b.clientHeight*N;$.current.scale.set(re,fe,1)}ue.current=!0}}}else{const b=_.children[0];if(b!=null&&b.clientWidth&&b!=null&&b.clientHeight){const X=1/O.factor,N=b.clientWidth*X,re=b.clientHeight*X;$.current.scale.set(N,re,1),ue.current=!0}$.current.lookAt(R.camera.position)}});const Ie=a.useMemo(()=>({vertexShader:u?void 0:`
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
      `}),[u]);return a.createElement("group",ge({},E,{ref:j}),f&&!de&&a.createElement("mesh",{castShadow:m,receiveShadow:y,ref:$},v||a.createElement("planeGeometry",null),w||a.createElement("shaderMaterial",{side:Mt,vertexShader:Ie.vertexShader,fragmentShader:Ie.fragmentShader})))}),ot=nt>=125?"uv1":"uv2",ln={uniforms:{tDiffuse:{value:null},h:{value:1/512}},vertexShader:`
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
  `},un={uniforms:{tDiffuse:{value:null},v:{value:1/512}},vertexShader:`
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
  `},$e=new Ce,me=new z;class Be extends Et{constructor(){super(),this.isLineSegmentsGeometry=!0,this.type="LineSegmentsGeometry";const e=[-1,2,0,1,2,0,-1,1,0,1,1,0,-1,0,0,1,0,0,-1,-1,0,1,-1,0],t=[-1,2,1,2,-1,1,1,1,-1,-1,1,-1,-1,-2,1,-2],s=[0,2,1,2,3,1,2,4,3,4,5,3,4,6,5,6,7,5];this.setIndex(s),this.setAttribute("position",new He(e,3)),this.setAttribute("uv",new He(t,2))}applyMatrix4(e){const t=this.attributes.instanceStart,s=this.attributes.instanceEnd;return t!==void 0&&(t.applyMatrix4(e),s.applyMatrix4(e),t.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this}setPositions(e){let t;e instanceof Float32Array?t=e:Array.isArray(e)&&(t=new Float32Array(e));const s=new _e(t,6,1);return this.setAttribute("instanceStart",new ie(s,3,0)),this.setAttribute("instanceEnd",new ie(s,3,3)),this.computeBoundingBox(),this.computeBoundingSphere(),this}setColors(e,t=3){let s;e instanceof Float32Array?s=e:Array.isArray(e)&&(s=new Float32Array(e));const n=new _e(s,t*2,1);return this.setAttribute("instanceColorStart",new ie(n,t,0)),this.setAttribute("instanceColorEnd",new ie(n,t,t)),this}fromWireframeGeometry(e){return this.setPositions(e.attributes.position.array),this}fromEdgesGeometry(e){return this.setPositions(e.attributes.position.array),this}fromMesh(e){return this.fromWireframeGeometry(new Ut(e.geometry)),this}fromLineSegments(e){const t=e.geometry;return this.setPositions(t.attributes.position.array),this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new Ce);const e=this.attributes.instanceStart,t=this.attributes.instanceEnd;e!==void 0&&t!==void 0&&(this.boundingBox.setFromBufferAttribute(e),$e.setFromBufferAttribute(t),this.boundingBox.union($e))}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new it),this.boundingBox===null&&this.computeBoundingBox();const e=this.attributes.instanceStart,t=this.attributes.instanceEnd;if(e!==void 0&&t!==void 0){const s=this.boundingSphere.center;this.boundingBox.getCenter(s);let n=0;for(let o=0,c=e.count;o<c;o++)me.fromBufferAttribute(e,o),n=Math.max(n,s.distanceToSquared(me)),me.fromBufferAttribute(t,o),n=Math.max(n,s.distanceToSquared(me));this.boundingSphere.radius=Math.sqrt(n),isNaN(this.boundingSphere.radius)&&console.error("THREE.LineSegmentsGeometry.computeBoundingSphere(): Computed radius is NaN. The instanced position data is likely to have NaN values.",this)}}toJSON(){}applyMatrix(e){return console.warn("THREE.LineSegmentsGeometry: applyMatrix() has been renamed to applyMatrix4()."),this.applyMatrix4(e)}}class rt extends Be{constructor(){super(),this.isLineGeometry=!0,this.type="LineGeometry"}setPositions(e){const t=e.length-3,s=new Float32Array(2*t);for(let n=0;n<t;n+=3)s[2*n]=e[n],s[2*n+1]=e[n+1],s[2*n+2]=e[n+2],s[2*n+3]=e[n+3],s[2*n+4]=e[n+4],s[2*n+5]=e[n+5];return super.setPositions(s),this}setColors(e,t=3){const s=e.length-t,n=new Float32Array(2*s);if(t===3)for(let o=0;o<s;o+=t)n[2*o]=e[o],n[2*o+1]=e[o+1],n[2*o+2]=e[o+2],n[2*o+3]=e[o+3],n[2*o+4]=e[o+4],n[2*o+5]=e[o+5];else for(let o=0;o<s;o+=t)n[2*o]=e[o],n[2*o+1]=e[o+1],n[2*o+2]=e[o+2],n[2*o+3]=e[o+3],n[2*o+4]=e[o+4],n[2*o+5]=e[o+5],n[2*o+6]=e[o+6],n[2*o+7]=e[o+7];return super.setColors(n,t),this}fromLine(e){const t=e.geometry;return this.setPositions(t.attributes.position.array),this}}class Re extends De{constructor(e){super({type:"LineMaterial",uniforms:Fe.clone(Fe.merge([Ne.common,Ne.fog,{worldUnits:{value:1},linewidth:{value:1},resolution:{value:new Le(1,1)},dashOffset:{value:0},dashScale:{value:1},dashSize:{value:1},gapSize:{value:1}}])),vertexShader:`
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
					#include <${nt>=154?"colorspace_fragment":"encodings_fragment"}>
					#include <fog_fragment>
					#include <premultiplied_alpha_fragment>

				}
			`,clipping:!0}),this.isLineMaterial=!0,this.onBeforeCompile=function(){this.transparent?this.defines.USE_LINE_COLOR_ALPHA="1":delete this.defines.USE_LINE_COLOR_ALPHA},Object.defineProperties(this,{color:{enumerable:!0,get:function(){return this.uniforms.diffuse.value},set:function(t){this.uniforms.diffuse.value=t}},worldUnits:{enumerable:!0,get:function(){return"WORLD_UNITS"in this.defines},set:function(t){t===!0?this.defines.WORLD_UNITS="":delete this.defines.WORLD_UNITS}},linewidth:{enumerable:!0,get:function(){return this.uniforms.linewidth.value},set:function(t){this.uniforms.linewidth.value=t}},dashed:{enumerable:!0,get:function(){return"USE_DASH"in this.defines},set(t){!!t!="USE_DASH"in this.defines&&(this.needsUpdate=!0),t===!0?this.defines.USE_DASH="":delete this.defines.USE_DASH}},dashScale:{enumerable:!0,get:function(){return this.uniforms.dashScale.value},set:function(t){this.uniforms.dashScale.value=t}},dashSize:{enumerable:!0,get:function(){return this.uniforms.dashSize.value},set:function(t){this.uniforms.dashSize.value=t}},dashOffset:{enumerable:!0,get:function(){return this.uniforms.dashOffset.value},set:function(t){this.uniforms.dashOffset.value=t}},gapSize:{enumerable:!0,get:function(){return this.uniforms.gapSize.value},set:function(t){this.uniforms.gapSize.value=t}},opacity:{enumerable:!0,get:function(){return this.uniforms.opacity.value},set:function(t){this.uniforms.opacity.value=t}},resolution:{enumerable:!0,get:function(){return this.uniforms.resolution.value},set:function(t){this.uniforms.resolution.value.copy(t)}},alphaToCoverage:{enumerable:!0,get:function(){return"USE_ALPHA_TO_COVERAGE"in this.defines},set:function(t){!!t!="USE_ALPHA_TO_COVERAGE"in this.defines&&(this.needsUpdate=!0),t===!0?(this.defines.USE_ALPHA_TO_COVERAGE="",this.extensions.derivatives=!0):(delete this.defines.USE_ALPHA_TO_COVERAGE,this.extensions.derivatives=!1)}}}),this.setValues(e)}}const Me=new se,qe=new z,Ze=new z,D=new se,A=new se,T=new se,Ee=new z,Ue=new Dt,P=new _t,Xe=new z,he=new Ce,pe=new it,W=new se;let H,K;function Qe(i,e,t){return W.set(0,0,-e,1).applyMatrix4(i.projectionMatrix),W.multiplyScalar(1/W.w),W.x=K/t.width,W.y=K/t.height,W.applyMatrix4(i.projectionMatrixInverse),W.multiplyScalar(1/W.w),Math.abs(Math.max(W.x,W.y))}function dn(i,e){const t=i.matrixWorld,s=i.geometry,n=s.attributes.instanceStart,o=s.attributes.instanceEnd,c=Math.min(s.instanceCount,n.count);for(let r=0,d=c;r<d;r++){P.start.fromBufferAttribute(n,r),P.end.fromBufferAttribute(o,r),P.applyMatrix4(t);const l=new z,u=new z;H.distanceSqToSegment(P.start,P.end,u,l),u.distanceTo(l)<K*.5&&e.push({point:u,pointOnLine:l,distance:H.origin.distanceTo(u),object:i,face:null,faceIndex:r,uv:null,[ot]:null})}}function fn(i,e,t){const s=e.projectionMatrix,o=i.material.resolution,c=i.matrixWorld,r=i.geometry,d=r.attributes.instanceStart,l=r.attributes.instanceEnd,u=Math.min(r.instanceCount,d.count),f=-e.near;H.at(1,T),T.w=1,T.applyMatrix4(e.matrixWorldInverse),T.applyMatrix4(s),T.multiplyScalar(1/T.w),T.x*=o.x/2,T.y*=o.y/2,T.z=0,Ee.copy(T),Ue.multiplyMatrices(e.matrixWorldInverse,c);for(let p=0,m=u;p<m;p++){if(D.fromBufferAttribute(d,p),A.fromBufferAttribute(l,p),D.w=1,A.w=1,D.applyMatrix4(Ue),A.applyMatrix4(Ue),D.z>f&&A.z>f)continue;if(D.z>f){const h=D.z-A.z,S=(D.z-f)/h;D.lerp(A,S)}else if(A.z>f){const h=A.z-D.z,S=(A.z-f)/h;A.lerp(D,S)}D.applyMatrix4(s),A.applyMatrix4(s),D.multiplyScalar(1/D.w),A.multiplyScalar(1/A.w),D.x*=o.x/2,D.y*=o.y/2,A.x*=o.x/2,A.y*=o.y/2,P.start.copy(D),P.start.z=0,P.end.copy(A),P.end.z=0;const w=P.closestPointToPointParameter(Ee,!0);P.at(w,Xe);const v=At.lerp(D.z,A.z,w),x=v>=-1&&v<=1,M=Ee.distanceTo(Xe)<K*.5;if(x&&M){P.start.fromBufferAttribute(d,p),P.end.fromBufferAttribute(l,p),P.start.applyMatrix4(c),P.end.applyMatrix4(c);const h=new z,S=new z;H.distanceSqToSegment(P.start,P.end,S,h),t.push({point:S,pointOnLine:h,distance:H.origin.distanceTo(S),object:i,face:null,faceIndex:p,uv:null,[ot]:null})}}}class at extends C{constructor(e=new Be,t=new Re({color:Math.random()*16777215})){super(e,t),this.isLineSegments2=!0,this.type="LineSegments2"}computeLineDistances(){const e=this.geometry,t=e.attributes.instanceStart,s=e.attributes.instanceEnd,n=new Float32Array(2*t.count);for(let c=0,r=0,d=t.count;c<d;c++,r+=2)qe.fromBufferAttribute(t,c),Ze.fromBufferAttribute(s,c),n[r]=r===0?0:n[r-1],n[r+1]=n[r]+qe.distanceTo(Ze);const o=new _e(n,2,1);return e.setAttribute("instanceDistanceStart",new ie(o,1,0)),e.setAttribute("instanceDistanceEnd",new ie(o,1,1)),this}raycast(e,t){const s=this.material.worldUnits,n=e.camera;n===null&&!s&&console.error('LineSegments2: "Raycaster.camera" needs to be set in order to raycast against LineSegments2 while worldUnits is set to false.');const o=e.params.Line2!==void 0&&e.params.Line2.threshold||0;H=e.ray;const c=this.matrixWorld,r=this.geometry,d=this.material;K=d.linewidth+o,r.boundingSphere===null&&r.computeBoundingSphere(),pe.copy(r.boundingSphere).applyMatrix4(c);let l;if(s)l=K*.5;else{const f=Math.max(n.near,pe.distanceToPoint(H.origin));l=Qe(n,f,d.resolution)}if(pe.radius+=l,H.intersectsSphere(pe)===!1)return;r.boundingBox===null&&r.computeBoundingBox(),he.copy(r.boundingBox).applyMatrix4(c);let u;if(s)u=K*.5;else{const f=Math.max(n.near,he.distanceToPoint(H.origin));u=Qe(n,f,d.resolution)}he.expandByScalar(u),H.intersectsBox(he)!==!1&&(s?dn(this,t):fn(this,n,t))}onBeforeRender(e){const t=this.material.uniforms;t&&t.resolution&&(e.getViewport(Me),this.material.uniforms.resolution.value.set(Me.z,Me.w))}}class mn extends at{constructor(e=new rt,t=new Re({color:Math.random()*16777215})){super(e,t),this.isLine2=!0,this.type="Line2"}}const hn=a.forwardRef(function({points:e,color:t=16777215,vertexColors:s,linewidth:n,lineWidth:o,segments:c,dashed:r,...d},l){var u,f;const p=B(x=>x.size),m=a.useMemo(()=>c?new at:new mn,[c]),[y]=a.useState(()=>new Re),w=(s==null||(u=s[0])==null?void 0:u.length)===4?4:3,v=a.useMemo(()=>{const x=c?new Be:new rt,M=e.map(h=>{const S=Array.isArray(h);return h instanceof z||h instanceof se?[h.x,h.y,h.z]:h instanceof Le?[h.x,h.y,0]:S&&h.length===3?[h[0],h[1],h[2]]:S&&h.length===2?[h[0],h[1],0]:h});if(x.setPositions(M.flat()),s){t=16777215;const h=s.map(S=>S instanceof ze?S.toArray():S);x.setColors(h.flat(),w)}return x},[e,c,s,w]);return a.useLayoutEffect(()=>{m.computeLineDistances()},[e,m]),a.useLayoutEffect(()=>{r?y.defines.USE_DASH="":delete y.defines.USE_DASH,y.needsUpdate=!0},[r,y]),a.useEffect(()=>()=>{v.dispose(),y.dispose()},[v]),a.createElement("primitive",ge({object:m,ref:l},d),a.createElement("primitive",{object:v,attach:"geometry"}),a.createElement("primitive",ge({object:y,attach:"material",color:t,vertexColors:!!s,resolution:[p.width,p.height],linewidth:(f=n??o)!==null&&f!==void 0?f:1,dashed:r,transparent:w===4},d)))}),pn=a.forwardRef(({scale:i=10,frames:e=1/0,opacity:t=1,width:s=1,height:n=1,blur:o=1,near:c=0,far:r=10,resolution:d=512,smooth:l=!0,color:u="#000000",depthWrite:f=!1,renderOrder:p,...m},y)=>{const w=a.useRef(null),v=B(O=>O.scene),x=B(O=>O.gl),M=a.useRef(null);s=s*(Array.isArray(i)?i[0]:i||1),n=n*(Array.isArray(i)?i[1]:i||1);const[h,S,G,E,F,V,U]=a.useMemo(()=>{const O=new Ge(d,d),_=new Ge(d,d);_.texture.generateMipmaps=O.texture.generateMipmaps=!1;const J=new Pt(s,n).rotateX(Math.PI/2),j=new C(J),q=new Lt;q.depthTest=q.depthWrite=!1,q.onBeforeCompile=I=>{I.uniforms={...I.uniforms,ucolor:{value:new ze(u)}},I.fragmentShader=I.fragmentShader.replace("void main() {",`uniform vec3 ucolor;
           void main() {
          `),I.fragmentShader=I.fragmentShader.replace("vec4( vec3( 1.0 - fragCoordZ ), opacity );","vec4( ucolor * fragCoordZ * 2.0, ( 1.0 - fragCoordZ ) * 1.0 );")};const Z=new De(ln),k=new De(un);return k.depthTest=Z.depthTest=!1,[O,J,q,j,Z,k,_]},[d,s,n,i,u]),oe=O=>{E.visible=!0,E.material=F,F.uniforms.tDiffuse.value=h.texture,F.uniforms.h.value=O*1/256,x.setRenderTarget(U),x.render(E,M.current),E.material=V,V.uniforms.tDiffuse.value=U.texture,V.uniforms.v.value=O*1/256,x.setRenderTarget(h),x.render(E,M.current),E.visible=!1};let L=0,ce,le;return xe(()=>{M.current&&(e===1/0||L<e)&&(L++,ce=v.background,le=v.overrideMaterial,w.current.visible=!1,v.background=null,v.overrideMaterial=G,x.setRenderTarget(h),x.render(v,M.current),oe(o),l&&oe(o*.4),x.setRenderTarget(null),w.current.visible=!0,v.overrideMaterial=le,v.background=ce)}),a.useImperativeHandle(y,()=>w.current,[]),a.createElement("group",ge({"rotation-x":Math.PI/2},m,{ref:w}),a.createElement("mesh",{renderOrder:p,geometry:S,scale:[1,-1,1],rotation:[-Math.PI/2,0,0]},a.createElement("meshBasicMaterial",{transparent:!0,map:h.texture,opacity:t,depthWrite:f})),a.createElement("orthographicCamera",{ref:M,args:[-s/2,s/2,n/2,-n/2,c,r]}))});class vn extends Ct{constructor(){super();const e=new zt;e.deleteAttribute("uv");const t=new Ve({side:jt}),s=new Ve,n=new Bt(16777215,900,28,2);n.position.set(.418,16.199,.3),this.add(n);const o=new C(e,t);o.position.set(-.757,13.219,.717),o.scale.set(31.713,28.305,28.591),this.add(o);const c=new C(e,s);c.position.set(-10.906,2.009,1.846),c.rotation.set(0,-.195,0),c.scale.set(2.328,7.905,4.651),this.add(c);const r=new C(e,s);r.position.set(-5.607,-.754,-.758),r.rotation.set(0,.994,0),r.scale.set(1.97,1.534,3.955),this.add(r);const d=new C(e,s);d.position.set(6.167,.857,7.803),d.rotation.set(0,.561,0),d.scale.set(3.927,6.285,3.687),this.add(d);const l=new C(e,s);l.position.set(-2.017,.018,6.124),l.rotation.set(0,.333,0),l.scale.set(2.002,4.566,2.064),this.add(l);const u=new C(e,s);u.position.set(2.291,-.756,-2.621),u.rotation.set(0,-.286,0),u.scale.set(1.546,1.552,1.496),this.add(u);const f=new C(e,s);f.position.set(-2.193,-.369,-5.547),f.rotation.set(0,.516,0),f.scale.set(3.875,3.487,2.986),this.add(f);const p=new C(e,ne(50));p.position.set(-16.116,14.37,8.208),p.scale.set(.1,2.428,2.739),this.add(p);const m=new C(e,ne(50));m.position.set(-16.109,18.021,-8.207),m.scale.set(.1,2.425,2.751),this.add(m);const y=new C(e,ne(17));y.position.set(14.904,12.198,-1.832),y.scale.set(.15,4.265,6.331),this.add(y);const w=new C(e,ne(43));w.position.set(-.462,8.89,14.52),w.scale.set(4.38,5.441,.088),this.add(w);const v=new C(e,ne(20));v.position.set(3.235,11.486,-12.541),v.scale.set(2.5,2,.1),this.add(v);const x=new C(e,ne(100));x.position.set(0,20,0),x.scale.set(1,.1,1),this.add(x)}dispose(){const e=new Set;this.traverse(t=>{t.isMesh&&(e.add(t.geometry),e.add(t.material))});for(const t of e)t.dispose()}}function ne(i){const e=new Rt;return e.color.setScalar(i),e}const Pe=30,Ye=1,Ke={inner:"#fbf9f5",outer:"#e8e1d5"};function gn(i,e,t){const s=t??i.widthIn,n=i.depthIn,o=e?gt(i,e):xt(i,yt(i,ve)),c={id:"stage",productId:i.id,x:0,y:0,rotation:0,...o,widthIn:s};return{r:{item:c,product:i,w:s,d:n,box:{minX:-s/2,minY:-n/2,maxX:s/2,maxY:n/2},z0:i.elevationIn,z1:i.elevationIn+i.heightIn},finish:wt(c,i,ve)}}function Je(){try{return matchMedia("(prefers-reduced-motion: reduce)").matches}catch{return!1}}function xn(){const i=B(s=>s.gl),e=B(s=>s.scene),t=B(s=>s.invalidate);return a.useLayoutEffect(()=>{const s=new Ht(i),n=new vn,o=s.fromScene(n,.04);return n.dispose(),s.dispose(),e.environment=o.texture,t(),()=>{e.environment===o.texture&&(e.environment=null),o.dispose()}},[i,e,t]),null}function yn({root:i}){const e=a.useMemo(()=>new Map,[]);return a.useEffect(()=>()=>{e.forEach(t=>t.dispose()),e.clear()},[e]),xe(()=>{var t;(t=i.current)==null||t.traverse(s=>{const n=s;if(!n.isMesh||Array.isArray(n.material))return;const o=n.material;if(!(o!=null&&o.isMeshPhysicalMaterial)||!o.transparent||o.transmission>0||o.opacity>=.97)return;let c=e.get(o);c||(c=new qt({color:o.color.clone().lerp(new ze("#ffffff"),o.opacity<.5?.6:0),roughness:Math.min(o.roughness,.06),metalness:0,transmission:1,thickness:.25,ior:1.5,clearcoat:1,clearcoatRoughness:.03,side:o.side}),e.set(o,c)),n.material=c})},-2),null}function wn({r:i,finish:e,ctx:t,onModel:s}){var l;const{product:n}=i,o=n.source!=="missing"?(l=n.model)==null?void 0:l.url:void 0,c=bt(n)?g.jsx(Ft,{r:i,surfaces:ve,ctx:t,bare:!0}):Nt({r:i,finish:e,ctx:t}),r=a.useMemo(()=>({w:i.w,h:n.heightIn,d:n.depthIn}),[i.w,n.heightIn,n.depthIn]),d=a.useMemo(()=>Gt(e,t),[e.id,e.hex,e.material,t]);return a.useEffect(()=>{o||s(!0)},[o]),o?g.jsx("group",{position:[0,n.elevationIn,0],children:g.jsx(Vt,{url:o,target:r,slots:d,onReady:s,fallback:g.jsx("group",{position:[0,-n.elevationIn,0],children:c})})}):c}function Sn({frame:i,w:e,d:t,h:s}){const n=a.useRef(null),o=B(S=>S.camera),c=B(S=>S.invalidate),{off:r,tick:d}=Yt(e,t),l=i.bottom+.3,u=-e/2,f=e/2,p=-t/2,m=t/2,y=m+r,w=f+r,v=u-r,x=i.bottom,M=i.bottom+s,h=a.useMemo(()=>[[u,l,y],[f,l,y],[u,l,y-d],[u,l,y+d],[f,l,y-d],[f,l,y+d],[w,l,p],[w,l,m],[w-d,l,p],[w+d,l,p],[w-d,l,m],[w+d,l,m],[v,x,m],[v,M,m],[v-d,x,m],[v+d,x,m],[v-d,M,m],[v+d,M,m]],[u,f,p,m,y,w,v,l,x,M,d]);return a.useEffect(()=>{var S;o.layers.enable(Ye),(S=n.current)==null||S.traverse(G=>G.layers.set(Ye)),c()},[o,c,h]),g.jsxs("group",{ref:n,name:"stage-dims",children:[g.jsx(hn,{points:h,segments:!0,color:"#c2542d",lineWidth:1.6,depthTest:!1,renderOrder:10}),g.jsxs(be,{position:[0,l,y+d*1.6],center:!0,className:"stage-dim",zIndexRange:[5,0],children:[g.jsx("b",{children:"W"})," ",Se(e,we)]}),g.jsxs(be,{position:[w+d*1.6,l,0],center:!0,className:"stage-dim",zIndexRange:[5,0],children:[g.jsx("b",{children:"D"})," ",Se(t,we)]}),g.jsxs(be,{position:[v-d*1.6,(x+M)/2,m],center:!0,className:"stage-dim",zIndexRange:[5,0],children:[g.jsx("b",{children:"H"})," ",Se(s,we)]})]})}function bn({frame:i,autoRotate:e,onInteract:t}){const s=a.useRef(null),n=B(u=>u.camera),o=B(u=>u.size),c=B(u=>u.invalidate),r=o.width/Math.max(1,o.height),d=Math.round(r*20),l=a.useMemo(()=>Qt(i,Pe,d/20),[i,d]);return a.useLayoutEffect(()=>{n.fov=Pe,n.near=Math.max(.02,l.radius/50),n.far=l.distance*8+10,n.position.set(...l.position),n.updateProjectionMatrix();const u=s.current;u&&(u.target.set(...l.target),u.update()),c()},[l,n,c]),g.jsx(kt,{ref:s,makeDefault:!0,enablePan:!1,enableDamping:!0,dampingFactor:.09,autoRotate:e,autoRotateSpeed:1.1,minDistance:l.minDistance,maxDistance:l.maxDistance,minPolarAngle:.12,maxPolarAngle:Math.PI/2-.03,onStart:t})}function Mn(i,e,t){const s=i.createRadialGradient(e/2,t*.42,0,e/2,t*.42,Math.max(e,t)*.75);s.addColorStop(0,Ke.inner),s.addColorStop(1,Ke.outer),i.fillStyle=s,i.fillRect(0,0,e,t)}function En(i,e,t){const s=i(),{gl:n,scene:o,invalidate:c}=s,r=s.camera,d=s.controls,l=(d==null?void 0:d.target.clone())??new z,u=o.getObjectByName("stage-dims"),f=Math.min(4096,n.capabilities.maxTextureSize),p=Math.max(64,Math.min(Math.round(t),f)),m={pos:r.position.clone(),quat:r.quaternion.clone(),aspect:r.aspect,pr:n.getPixelRatio(),dims:(u==null?void 0:u.visible)??!1},y=document.createElement("canvas");y.width=y.height=p;try{u&&(u.visible=!1);const w=r.position.clone().sub(l).normalize();r.aspect=1,r.position.copy(l).addScaledVector(w,Kt(e,r.fov,1,1.02)),r.lookAt(l),r.updateProjectionMatrix(),r.updateMatrixWorld(),n.setPixelRatio(1),n.setSize(p,p,!1),n.render(o,r);const v=y.getContext("2d");if(!v)throw new Error("This browser can’t make the image.");Mn(v,p,p),v.drawImage(n.domElement,0,0,p,p)}finally{u&&(u.visible=m.dims),r.position.copy(m.pos),r.quaternion.copy(m.quat),r.aspect=m.aspect,r.updateProjectionMatrix(),r.updateMatrixWorld(),n.setPixelRatio(m.pr),n.setSize(s.size.width,s.size.height,!1),c()}return y}function Un({radius:i,onStill:e}){const t=B(n=>n.get),s=a.useRef(i);return s.current=i,a.useEffect(()=>{const n=async o=>En(t,s.current,o);return e==null||e(n),$t({stage:{get:t,renderStill:async o=>{const c=await n(o);return{width:c.width,height:c.height}}}}),()=>e==null?void 0:e(null)},[t,e]),null}function _n({ready:i,onReady:e}){const t=a.useRef(!1),s=B(n=>n.invalidate);return a.useEffect(()=>{i&&s()},[i,s]),xe(()=>{!i||t.current||(t.current=!0,requestAnimationFrame(()=>e()))}),null}function Dn({product:i,finishId:e,widthIn:t,showDims:s,autoRotate:n,onReady:o,onStill:c}){var F;const{r,finish:d}=a.useMemo(()=>gn(i,e,t),[i,e,t]),l=a.useMemo(()=>Zt({w:r.w,d:i.depthIn,h:i.heightIn,elevationIn:i.elevationIn,kind:i.kind}),[r.w,i.depthIn,i.heightIn,i.elevationIn,i.kind]),u=a.useMemo(()=>Xt(l,r.w,i.depthIn),[l,r.w,i.depthIn]),f=a.useMemo(()=>Tt(ve,{ceilingIn:l.ceilingIn}),[l.ceilingIn]),p=i.source!=="missing"&&((F=i.model)==null?void 0:F.url)||null,[m,y]=a.useState(null),w=m!==null&&m.url===p,[v,x]=a.useState(()=>n&&!Je()),M=a.useRef(null),{min:h,max:S}=l.box,G=Math.hypot(S[0]-h[0],S[1]-h[1],S[2]-h[2])/24,E=Math.max(r.w,i.depthIn)/12;return a.useEffect(()=>x(n&&!Je()),[n]),g.jsxs(g.Fragment,{children:[g.jsx(xn,{}),g.jsx("ambientLight",{intensity:.12}),g.jsx("directionalLight",{position:[3.5,7,5],intensity:1.15,color:"#fff6ea"}),g.jsx("directionalLight",{position:[-5,3,-2],intensity:.35,color:"#e8eef8"}),g.jsxs("group",{scale:1/12,children:[g.jsx("group",{ref:M,position:[0,l.lift,0],children:g.jsx(wn,{r,finish:d,ctx:f,onModel:V=>y({url:p,ok:V})})}),s&&g.jsx(Sn,{frame:l,w:r.w,d:i.depthIn,h:i.heightIn})]}),g.jsx(pn,{frames:1,position:[0,-.02,0],scale:Math.max(2,E*2.4),far:Math.max(1,(l.top+4)/12),blur:2.6,opacity:.5,resolution:1024,color:"#3a3127"},`${i.id}:${r.w}:${w?String(m==null?void 0:m.ok):"loading"}`),g.jsx(yn,{root:M}),g.jsx(bn,{frame:u,autoRotate:v,onInteract:()=>x(!1)}),g.jsx(Un,{radius:G,onStill:c}),g.jsx(_n,{ready:w,onReady:o},p??i.id),St&&g.jsx(Wt,{name:"stage"})]})}function An({product:i,finishId:e,widthIn:t,autoRotate:s=!0,showDims:n=!1,height:o=360,onReady:c,onStill:r,className:d=""}){var p;const[l,u]=a.useState(!1),f=a.useRef(c);return f.current=c,a.useEffect(()=>u(!1),[i.id,(p=i.model)==null?void 0:p.url]),g.jsx("div",{className:`product-stage ${d}`,style:{height:o},"data-ready":l?"1":void 0,role:"img","aria-label":`3D view of ${i.name}. Drag to turn it; scroll or pinch to zoom.`,children:g.jsx(Ot,{frameloop:"demand",dpr:[1,2],gl:{antialias:!0,alpha:!0,preserveDrawingBuffer:!1,powerPreference:"high-performance"},camera:{fov:Pe,near:.05,far:100,position:[3,2.5,5]},onCreated:({gl:m})=>{m.toneMapping=It,m.toneMappingExposure=1,m.setClearColor(0,0)},children:g.jsx(a.Suspense,{fallback:null,children:g.jsx(Dn,{product:i,finishId:e,widthIn:t,showDims:n,autoRotate:s,onStill:r,onReady:()=>{var m;u(!0),(m=f.current)==null||m.call(f)}})})})})}function Rn(i){return g.jsx(An,{...i})}export{An as StageView,Rn as default,gn as stageItem};
