pipeline {
    agent { label 'mac-worker' }

    environment {
        CLUSTER_URL = 'https://api.openshift-ai-lab01.ocp-ai.corp.sourcesense.com:6443'
        PROJECT_NAME = 'progetto-studenti-app'
        APP_NAME     = 'frontend-image'
        APP_DIR      = 'frontend'
    }

    triggers {
        pollSCM('H * * * *')
    }

    stages {
        stage('Login & Test OpenShift') {
            steps {
                // Legge il token salvato nelle credenziali usando l'ID 'openshift-sa-token'
                withCredentials([
                    string(credentialsId: 'openshift-sa-token', variable: 'OC_TOKEN'),
                    file(credentialsId: 'postgres-db-secret', variable: 'DB_PASSWORD')
                    ]) {
                    sh '''
                    # Login al cluster
                    oc login ${CLUSTER_URL} --token=${OC_TOKEN} --insecure-skip-tls-verify=true
                    
                    # Selezione del namespace
                    oc project ${PROJECT_NAME}

                     # Applica il secret di redis
                    oc apply -f "$DB_PASSWORD"

                    # Applica il pvc per il database
                    oc apply -f openshift/00-db-pvc.yaml
                    oc apply -f openshift/01-db-statefulset.yaml
                    oc apply -f openshift/02-db-service.yaml
                    oc apply -f openshift/03-db-configmap.yaml
                    oc apply -f openshift/04-app-deployment.yaml
                    oc apply -f openshift/05-app-service.yaml
                    oc apply -f openshift/06-route-frontend.yaml

                    # Verifica dei Pods attualmente attivi nel namespace
                    echo "--- Lista Pods attivi ---"
                    oc get pods
                    '''
                }
            }
        }

        stage('Frontend: crea BuildConfig') {
            steps {
                sh '''
                if oc get bc/"$APP_NAME" >/dev/null 2>&1; then
                    echo "BuildConfig $APP_NAME già presente, la riuso"
                else
                    oc new-build --name="$APP_NAME" --binary --strategy=docker
                fi
                '''
            }
        }

        stage('Frontend: build e push immagine') {
            steps {
                sh '''
                oc start-build "$APP_NAME" --from-dir="$APP_DIR" --follow --wait
                oc tag "$APP_NAME:latest" "$APP_NAME:build-$BUILD_NUMBER"
                '''
            }
        }

        stage('Verifica') {
            steps {
                sh '''
                echo "--- Stato del progetto ---"
                oc get pods,svc,pvc,route
                oc get is "$APP_NAME"
                '''
            }
        }
    }
}