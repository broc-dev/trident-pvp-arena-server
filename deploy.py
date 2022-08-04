import requests
import json
import os
import time
from dotenv import load_dotenv

load_dotenv()

API_TOKEN = os.getenv('API_KEY')

buildDir = "./lib"

baseURL = "https://public-api.colyseus.dev/api/v1/storage/4e8169d2fe7cc44243f56ede02e6a172/"

baseHeaders = {
	"accept": "application/json",
	"x-api-token": API_TOKEN
}

# Retrieve a list of files on the server, and then delete them.

retrieveFilesURL = baseURL + "objects"

# Retrieve items
serverItemsRaw = requests.request('GET', retrieveFilesURL, headers=baseHeaders)
serverItemsJSON = json.loads(serverItemsRaw.text)["data"]

# Go through list, delete each file
for item in serverItemsJSON:
	if(item["Type"] == "file"):
		print("Deleting: " + item["Key"])
		formattedKey = item["Key"].replace("/", "%2F")
		url = baseURL + "object?objectPath=" + formattedKey
		killFile = requests.request('DELETE', url, headers=baseHeaders)
		print("Status: " + killFile.text)
		time.sleep(0.5) # Wait to avoid rate-limiting

# We'll be recursively uploading the 'lib' folder items to the server.

for dirpath, dirs, files in os.walk(buildDir):  
			for filename in files:
						filePath = os.path.join(dirpath,filename).lstrip("./").replace("/", "%2F")
						# file = {
						# 	"file=@": open(os.path.join(dirpath,filename)),
						# 	"type=": "application/x-javascript",
						# 	"content=": ""
						# }
						f = open(os.path.join(dirpath, filename), "rb")
						file = {
							"file": ("@"+filename, f),
							"type=": "application/x-javascript",
							"content=": "",
						}

						uploadHeaders = {
							"accept": "application/json",
							"x-api-token": API_TOKEN,
							"Content-Type": "multipart/form-data"
						}
						print("Uploading: " + filename)
						# formattedPath = filePath
						url = baseURL + "object?objectPath=" + filePath + "&isBinary=true"
						uploadFile = requests.request('PUT', url, files=file, headers=uploadHeaders)
						print("Status: " + uploadFile.text)
						time.sleep(0.5) # wait to avoid rate limiting


# File Sync, restart server

uploadURL = baseURL + "files-sync?restartDeployment=true"

uploadRes = requests.request('POST', uploadURL, headers=baseHeaders)

print(uploadRes.text)