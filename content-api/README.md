# TLB Kitchen content API

This service reads the bakery's existing MongoDB content for Pastries, Custom Orders and Blogs. It is designed to be deployed in the bakery owner's Render account. The ordering system continues to use its existing Supabase backend.

**Current stage: prepared for deployment.** The website still uses `https://tlbk-api.onrender.com/api`. Deploying this directory alone does not switch the website or move its database.

## 1. Open your own Render account

1. Open [Render](https://dashboard.render.com/register) and create an account you control.
2. Connect the GitHub account that has access to `PlayerBC/TLBK-Website`.
3. You can also connect the Render integration in our chat so we can inspect this new service together.

**Checkpoint:** you can open the Render dashboard. If it times out, try your phone with Wi-Fi off and check [Render's status](https://status.render.com/). A new account does not itself fix a network timeout.

## 2. Prepare access to your existing MongoDB content

In [MongoDB Atlas](https://cloud.mongodb.com/), select the project and cluster containing `tlb_kitchen_website`. Its collections should include `pastries`, `custom-orders` and `blogs`.

Create a separate database user for this API, for example `tlbk_content_reader`. Give it **read** access to **only `tlb_kitchen_website`**, restricted to the appropriate cluster. Keep its generated password privately. This is a database login, separate from your Atlas website login. If you cannot manage database users, the project's owner must provide that access. [Atlas database-user instructions](https://www.mongodb.com/docs/atlas/security-add-mongodb-users/)

Use the cluster's **Connect → Drivers** connection string with this new username and password. If the password contains special characters, encode them correctly in the connection string; Atlas provides guidance in its connection dialog. Do not post the completed connection string in chat, GitHub, website JavaScript, or screenshots.

**Checkpoint:** you have the private connection string for the existing cluster. No new cluster or content import is needed.

## 3. Create the Render service

In Render choose **New → Web Service**, connect `PlayerBC/TLBK-Website`, and enter these settings. [Render's Flask deployment instructions](https://render.com/docs/deploy-flask)

| Setting | Value |
|---|---|
| Name | `tlbk-content-api` (choose another if unavailable) |
| Branch | `feature/owned-content-api` |
| Language / runtime | Python 3 |
| Region | Singapore |
| Root directory | `content-api` |
| Build command | `pip install -r requirements.txt` |
| Start command | `gunicorn --bind 0.0.0.0:$PORT --workers 1 --threads 4 --timeout 30 app:app` |
| Instance type | Free for initial testing |
| Health check path | `/health` |
| Automatic deployments | Off initially |

Under **Environment**, enter:

| Name | Value |
|---|---|
| `PYTHON_VERSION` | `3.12.14` |
| `MONGODB_URI` | Your private connection string from Step 2 |
| `DATABASE_NAME` | `tlb_kitchen_website` |
| `ALLOWED_ORIGINS` | `https://thelittlebakerkitchen.com,https://www.thelittlebakerkitchen.com` |

The repository's [render.yaml](../render.yaml) also contains this configuration for Render's Blueprint deployment flow. Use one deployment method, not both. Its private connection string is requested separately. [Blueprint reference](https://render.com/docs/blueprint-spec) · [Python version setting](https://render.com/docs/python-version)

Free services sleep after 15 minutes without incoming traffic and take about a minute to wake. This is suitable for initial checks; review an always-on paid instance before using the API for customers. Paying does not guarantee that the connection problem reported on your network will disappear. [Render's free-service limitations](https://render.com/docs/free)

## 4. Allow this service to reach MongoDB

1. Open the new Render service's details page.
2. Click **Connect → Outbound** and copy **all** listed IP ranges. Use the actual ranges shown there. [Render outbound-IP instructions](https://render.com/docs/outbound-ip-addresses)
3. In your MongoDB Atlas project, open **Network Access → IP Access List**, then add those ranges with a description such as `TLB Kitchen owned Render API`. Keep existing entries needed by other applications. There is no need to allow every internet address. [Atlas IP access instructions](https://www.mongodb.com/docs/atlas/security/ip-access-list/)
4. Return to Render. If the first deployment failed while access was being configured, use **Manual Deploy → Deploy latest commit**.

**Checkpoint:** Render reports the service is live. If not, copy its error message, with any connection string or password hidden. A build error concerns installing/running the code; a database connection error concerns credentials, the cluster or its access list.

## 5. Check the new service before switching

Copy the actual public service URL from Render. Do not guess it from the suggested name.

Open that URL with `/health` at the end. A successful check reports `status: healthy` and `database: connected`. This only checks database connectivity; it does not prove every page can load its content.

Send us the **public service URL**, which is safe to share. We will compare its categories, pictures, blog posts and both searches against the existing public content. The existing Atlas Search indexes are used; this API creates no indexes or documents.

Also open the new `/health` address on your PC and phone, testing Wi-Fi and mobile data. If your network cannot reach it, resolve that connection problem before changing the live website.

**Checkpoint:** data and search checks pass, and you can reach the new service from the devices where the old one failed.

## 6. Connect the website after those checks

The cutover will update the `API_BASE_URL` in these four files to the tested service URL followed by `/api`:

- `assets/js/pastries.js`
- `assets/js/customorders.js`
- `assets/js/blogs.js`
- `assets/js/blogpost.js`

We should add visible loading, error and retry messages at that stage, so a failed request never leaves unexplained empty space. These UI changes are not part of this API-only package.

After publishing, check all three page lists, categories, pagination, search and a full blog article on PC and phone. Rollback is restoring the old URL `https://tlbk-api.onrender.com/api` in those four files. Retain the previous service until the replacement is verified. This cutover needs no domain nameserver or website-hosting change.

## For developers

From `content-api`, create a Python virtual environment, install `requirements.txt`, then run:

```sh
python -m unittest discover -s tests -v
```

The tests use a fake database and do not contact or modify the real cluster. Run production with the Gunicorn command above, setting `PORT` and the environment variables first.

The compatibility endpoints accept only the query shapes used by the current public pages. Search pipelines are reconstructed on the server. There are no write routes, arbitrary collection names or arbitrary aggregation pipelines. Responses expose only the fields needed by the public pages; database errors are sanitized. CORS is not authentication: these routes intentionally serve public content. The dedicated read-only database user provides an additional permission boundary.
