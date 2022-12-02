# How to make a release


To begin with,

* You should be on the `main` branch.
* All the changes you want to make it into the release should be committed.
* Ensure that `CHANGELOG.md` has a complete entry for the release you're about to
  make. In particular, fill in the date for this entry and commit it.

Now make a release branch, of the form `releases/VERSION`. For example,
if releasing version 3.1.1,

    $ git checkout -b releases/3.1.1

Edit `package.json`, and remove the `-dev` tag on the version number.
Then do an `npm install` so the `package-lock.json` updates accordingly:

    $ npm install

Now build the project:

    $ gulp generic

Now you can stage everything. Note that you have to force-add the `build/generic` directory,
since it is gitignored. Be sure *not* to add all of `build`.

    $ git add .
    $ git add -f build/generic

Commit, with a simple message stating the version number. Then add a tag, and push both
the branch and the tag to GitHub. For example,

    $ git commit -m "Version 3.1.1"
    $ git tag v3.1.1
    $ git push origin releases/3.1.1
    $ git push origin v3.1.1

Go back to the `main` branch

    $ git checkout main

and bump the dev version number. For example, if the release tag was `v3.1.1`, then:

* Go into `package.json` and change the version to `3.2.0-dev`.
* In `CHANGELOG.md`, make an entry with heading `## 3.2.0 (------)`.
* Do an `npm install` to update `package-lock.json` accordingly:

    $ npm install

Finally, do a commit:

    $ git add .
    $ git commit -m "Bump dev version"

Finished!
