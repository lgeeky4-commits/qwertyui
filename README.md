# VISION SENTINEL — Render root-level upload (v1.2)

This is the simpler upload layout: **`package.json` and `index.html` are at the ZIP ROOT**, alongside `app.js` and `render.yaml`. There is NO `site/` subfolder to upload separately.

## FIX for `ENOENT ... /opt/render/project/src/package.json`

This specific message means Render ran an npm command in a directory **without** `package.json`.
The file **is included** in this ZIP. If the error persists, the issue is the files uploaded to GitHub (or Render's configured Root Directory/branch), not an npm dependency.

### Step 1: Correct the GitHub upload

1. Download and **extract** this ZIP. Do not upload the `.zip` file itself.
2. In GitHub, open the repository connected to Render and select **Add file > Upload files**.
3. In the extracted folder, select **all files and folders inside**, then drag/drop those into the GitHub upload page. Do **not** drag the enclosing extracted folder.
4. Commit changes. At the TOP LEVEL of the GitHub repo you must see:

```
index.html
app.js
motion.js
tracking.js
styles.css
favicon.svg
package.json   <-- THIS MUST BE VISIBLE NEXT TO index.html
server.js
verify-build.js
render.yaml
README.md
tests/
```

If instead GitHub shows a folder named `vision-sentinel-render-root-ready` or an uploaded ZIP, move/upload the files to the repository top level. If Render deploys from a specific branch, ensure the files are on that branch.

### Step 2: Render settings

If it is a **Web Service** (Node):

- Language/runtime: `Node`
- **Root Directory: blank** (delete any folder name)
- Build command: `npm install`
- Start command: `npm start`
- Ensure the connected repository and branch match where you uploaded files

If it is a **Static Site** (recommended):

- **Root Directory: blank**
- Build command: `npm run build`
- Publish directory: `dist`

Save settings then **Manual Deploy > Deploy latest commit**, or use **Clear build cache & deploy** if it still attempts an old build.

### Step 3: Validate locally (optional)

With Node 18+ installed in the extracted folder:

```sh
npm run build
npm test
npm start
```

Open `http://localhost:10000`. Deployed camera permission requires HTTPS, which Render provides for its onrender.com URLs.

## Capabilities / privacy

- Browser requests camera permission; phone/PC with HTTPS supported.
- Face boxes and temporary IDs using an AI model loaded from the web; the live feed is processed locally.
- Motion-region tracking is approximate and affected by camera movement; it doesn't identify object types.
- Snapshot and local video recording buttons.
- No face identification and no server upload of live camera frames.
